// Panorama viewer backed by Google's real Street View (the vendored, key-less Maps
// JS API in vendor/opensv/opensv.js). Movement mode is set via setMode():
//   moving — walk (click the road / arrows), pan, and zoom
//   nm     — no moving; pan and zoom allowed
//   nmpz   — no move, pan, or zoom (locked to the spawn view)

const OPENSV_SRC = 'vendor/opensv/opensv.js';
const DEFAULT_ZOOM = 1;
const FULLY_ZOOMED_OUT = -3; // bottom of OpenSV's panorama zoom range
const ZOOM_IN = 3;     // google SV zoom level for "zoomed in"
const TWEEN_MS = 160;  // matches MMA's tweenPov feel
const POSITION_EPSILON = 1e-5; // ~1 m; enough to bind a viewer event to its lookup
// Keys Street View uses to walk; blocked outside moving mode.
const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);

let loadPromise = null;
const streetViewReady = () =>
  Boolean(window.google?.maps?.StreetViewPanorama && window.google?.maps?.StreetViewService);

function samePosition(a, b) {
  if (!a || !b) return false;
  const latA = typeof a.lat === 'function' ? a.lat() : a.lat;
  const lngA = typeof a.lng === 'function' ? a.lng() : a.lng;
  const latB = typeof b.lat === 'function' ? b.lat() : b.lat;
  const lngB = typeof b.lng === 'function' ? b.lng() : b.lng;
  const lngDelta = Math.abs(((lngA - lngB + 540) % 360) - 180);
  return Math.abs(latA - latB) <= POSITION_EPSILON && lngDelta <= POSITION_EPSILON;
}

// Inject the vendored Maps JS API once. No tile-host rewrite => tiles hit Google
// directly, which works in a plain browser (verified by the throwaway prototype).
export function loadOpenSV() {
  if (streetViewReady()) return Promise.resolve(window.google);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = OPENSV_SRC;
    s.onload = async () => {
      const t0 = Date.now();
      while (!streetViewReady()) {
        if (Date.now() - t0 > 10000) return reject(new Error('opensv loaded but Street View missing'));
        await new Promise((r) => setTimeout(r, 50));
      }
      resolve(window.google);
    };
    s.onerror = () => reject(new Error('failed to load opensv.js'));
    document.head.appendChild(s);
  });
  return loadPromise;
}

export class OpenSvViewer {
  constructor(container) {
    this.container = container;
    this.onChange = null;       // callback(heading)
    this.defaultHeading = 0;
    this.defaultPitch = 0;
    this._startZoom = DEFAULT_ZOOM;
    this._tweenId = 0;
    this._startPanoId = null;   // the round's origin pano, so resetView can walk back
    this._trail = [];           // [{lat,lng}][] paths walked this round (Moving mode)
    this._trailActive = false;  // preparation must never look like player movement
    this._checkpoint = null;
    this._checkpointBusy = false;
    this._checkpointPeek = null;
    this._cancelCheckpointJump = null;
    this._lookBehind = null;
    this._roundToken = 0;
    this.mode = 'moving';       // 'moving' | 'nm' | 'nmpz'; set via setMode()

    // Street View mutates the inline style of the element it's given (position, etc.),
    // which would collapse our fixed/inset #pano to 0 height. Hand it a dedicated
    // 100%×100% inner div instead so #pano keeps its size.
    const host = document.createElement('div');
    host.style.width = '100%';
    host.style.height = '100%';
    container.appendChild(host);
    this.host = host;

    // Transparent overlay to block drag-look in NMPZ (Street View has no pan-disable
    // option). pointer-events toggles per mode; the HUD/guess map sit above it.
    const lock = document.createElement('div');
    Object.assign(lock.style, { position: 'absolute', inset: '0', zIndex: '1', pointerEvents: 'none' });
    container.appendChild(lock);
    this._lock = lock;

    const g = window.google;
    this.streetView = new g.maps.StreetViewService();
    this.pano = new g.maps.StreetViewPanorama(host, {
      disableDefaultUI: true,
      motionTracking: false,
      clickToGo: true,
      linksControl: true,
      showRoadLabels: false,
      scrollwheel: true,
      visible: false
    });
    // Live heading for the compass.
    this.pano.addListener('pov_changed', () => {
      if (this.onChange) this.onChange(this.pano.getPov().heading);
    });
    // Record each step so the result map can show where the player walked.
    this.pano.addListener('position_changed', () => {
      if (!this._trailActive || this._checkpointBusy) return;
      const p = this.pano.getPosition?.();
      if (!p) return;
      const point = { lat: p.lat(), lng: p.lng() };
      let segment = this._trail[this._trail.length - 1];
      if (!segment) { segment = []; this._trail.push(segment); }
      const last = segment[segment.length - 1];
      if (last && last.lat === point.lat && last.lng === point.lng) return;
      segment.push(point);
    });
    // Keyboard walking only in moving mode.
    host.addEventListener('keydown', (e) => {
      if (this.mode !== 'moving' && MOVE_KEYS.has(e.code)) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  // moving / nm / nmpz. clickToGo+links gate walking; scrollwheel gates zoom; the
  // overlay gates pan (look-around) for nmpz only.
  setMode(mode) {
    this.mode = mode === 'nm' || mode === 'nmpz' ? mode : 'moving';
    const moving = this.mode === 'moving';
    const nmpz = this.mode === 'nmpz';
    if (nmpz) this.endLookBehind();
    if (!moving) {
      this._clearCheckpoint();
      this._trailActive = false;
    } else if (this._trail.length) {
      this._trailActive = true;
    }
    this.pano.setOptions({ clickToGo: moving, linksControl: moving, scrollwheel: !nmpz });
    this._lock.style.pointerEvents = nmpz ? 'auto' : 'none';
  }

  // Starting view for this location (and where R returns to).
  setDefaultView(heading = 0, pitch = 0) {
    this.defaultHeading = heading;
    this.defaultPitch = pitch;
  }

  setStartZoomedOut(enabled) {
    this._startZoom = enabled ? FULLY_ZOOMED_OUT : DEFAULT_ZOOM;
    this.pano.setZoom(this._startZoom);
  }

  resetView() {
    this._cancelTween();
    // In moving mode, R also returns to where the round started.
    if (this._startPanoId && this.pano.getPano() !== this._startPanoId) {
      this.pano.setPano(this._startPanoId);
    }
    this.pano.setPov({ heading: this.defaultHeading, pitch: this.defaultPitch });
    this.pano.setZoom(this._startZoom);
  }

  getHeading() { return this.pano.getPov().heading; }
  get lat() { return this.pano.getPov().pitch; }

  // Separate walked paths; a checkpoint return starts a fresh segment.
  getTrail() { return this._trail.map((segment) => segment.map((point) => ({ ...point }))); }

  // Turn a prepared panorama into the active round. Preparation may happen while
  // the result screen covers the viewer, so reset the trail and focus only now.
  beginRound(loc) {
    this._clearCheckpoint();
    this._clearLookBehind();
    this._cancelTween();
    const heading = loc.heading ?? 0;
    const pitch = loc.pitch ?? 0;
    this.setDefaultView(heading, pitch);
    this.pano.setPov({ heading, pitch });
    this.pano.setZoom(this._startZoom);
    this._trail = [];
    const p = this.pano.getPosition?.();
    if (p) this._trail.push([{ lat: p.lat(), lng: p.lng() }]);
    this._trailActive = true;
    if (this.mode !== 'nmpz') this.pano.focus?.();
  }

  // C alternates between saving the exact current view and returning to it once.
  toggleCheckpoint() {
    if (this.mode !== 'moving' || !this._trailActive ||
        this._checkpointBusy || this._lookBehind) return;

    if (!this._checkpoint) {
      this._checkpoint = this._captureView();
      return;
    }

    const checkpoint = this._checkpoint;
    const token = this._roundToken;
    this._checkpointBusy = true;
    this._jumpToView(checkpoint).then((ok) => {
      if (token !== this._roundToken) return;
      this._cancelCheckpointJump = null;
      this._checkpointBusy = false;
      const p = this.pano.getPosition?.();
      const point = p
        ? { lat: p.lat(), lng: p.lng() }
        : { ...checkpoint.position };
      this._trail.push([point]);
      if (!ok) return; // keep the checkpoint so C can retry

      this._checkpoint = null;
      this.pano.focus?.();
    });
  }

  // V temporarily visits an armed checkpoint; releasing it restores this view.
  startCheckpointPeek() {
    if (this.mode !== 'moving' || !this._trailActive ||
        !this._checkpoint || this._checkpointBusy || this._lookBehind) return false;
    const source = this._captureView();
    if (!source) return false;

    const peek = {
      source,
      token: this._roundToken,
      ready: false,
      released: false,
      returning: false
    };
    this._checkpointPeek = peek;
    this._checkpointBusy = true;
    this._jumpToView(this._checkpoint).then((ok) => {
      if (this._checkpointPeek !== peek || peek.token !== this._roundToken) return;
      this._cancelCheckpointJump = null;
      if (!ok || peek.released) { this._restoreCheckpointPeek(peek); return; }
      peek.ready = true;
    });
    return true;
  }

  endCheckpointPeek() {
    const peek = this._checkpointPeek;
    if (!peek) return;
    peek.released = true;
    if (peek.ready) this._restoreCheckpointPeek(peek);
    else this._cancelCheckpointJump?.();
  }

  startLookBehind() {
    if (this.mode === 'nmpz' || this._checkpointBusy || this._lookBehind) return false;
    const pov = this.pano.getPov?.();
    if (!pov) return false;
    this._cancelTween();
    this._lookBehind = {
      token: this._roundToken,
      pov: { heading: pov.heading ?? 0, pitch: pov.pitch ?? 0 },
      zoom: this.pano.getZoom?.() ?? DEFAULT_ZOOM
    };
    this.pano.setPov({
      heading: (this._lookBehind.pov.heading + 180) % 360,
      pitch: this._lookBehind.pov.pitch
    });
    return true;
  }

  endLookBehind() {
    const view = this._lookBehind;
    if (!view) return;
    this._lookBehind = null;
    if (view.token !== this._roundToken) return;
    this._cancelTween();
    this.pano.setPov(view.pov);
    this.pano.setZoom(view.zoom);
    if (this.mode !== 'nmpz') this.pano.focus?.();
  }

  // faceNorth/zoom pan or zoom the view, so they no-op in nmpz (the locked mode).
  faceNorth() { if (this.mode !== 'nmpz') this._tweenPov(0, 0); }
  faceNorthDown() { if (this.mode !== 'nmpz') this._tweenPov(0, -90); }

  zoomFull(direction) {
    if (!direction || this.mode === 'nmpz') return;
    this.pano.setZoom(direction > 0 ? ZOOM_IN : FULLY_ZOOMED_OUT);
  }

  // Resolve one exact pano before touching the shared viewer. A failed lookup may
  // finish late, but its promise can no longer move a newer replacement location.
  showLocation(loc, { signal, focus = true } = {}) {
    this._clearCheckpoint();
    this._clearLookBehind();
    this._trailActive = false;
    this._trail = [];

    return new Promise((resolve) => {
      let done = false;
      let poll = 0;
      let timer = 0;
      let listeners = [];
      let targetPano = null;
      let targetPosition = null;

      const cleanup = () => {
        clearInterval(poll);
        clearTimeout(timer);
        for (const listener of listeners) listener?.remove?.();
        signal?.removeEventListener('abort', onAbort);
      };
      const finish = (ok) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(ok);
      };
      const isTarget = () =>
        this.pano.getPano?.() === targetPano &&
        (!targetPosition || samePosition(this.pano.getPosition?.(), targetPosition));
      const check = () => {
        if (!isTarget() || this.pano.getStatus?.() !== 'OK') return;
        this._startPanoId = targetPano;
        finish(true);
      };
      const onAbort = () => finish(false);

      timer = setTimeout(() => finish(false), 12000);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) { finish(false); return; }

      const request = loc.panoid
        ? { pano: loc.panoid }
        : { location: { lat: loc.lat, lng: loc.lng } };

      try {
        this.streetView.getPanorama(request).then(({ data }) => {
          if (done) return;
          const location = data?.location;
          if (!location?.pano) { finish(false); return; }

          targetPano = location.pano;
          targetPosition = location.latLng || null;
          listeners = [
            this.pano.addListener('pano_changed', check),
            this.pano.addListener('position_changed', check),
            this.pano.addListener('status_changed', check)
          ];
          // Some builds coalesce unchanged status events, so keep a cheap fallback.
          poll = setInterval(check, 150);

          this.pano.setPov({ heading: loc.heading ?? 0, pitch: loc.pitch ?? 0 });
          this.pano.setZoom(this._startZoom);
          this.pano.setPano(targetPano);
          this.pano.setVisible(true);
          if (focus && this.mode !== 'nmpz') this.pano.focus?.();
          check();
        }).catch(() => finish(false));
      } catch {
        finish(false);
      }
    });
  }

  _clearCheckpoint() {
    this._roundToken += 1;
    const cancel = this._cancelCheckpointJump;
    this._cancelCheckpointJump = null;
    this._checkpoint = null;
    this._checkpointBusy = false;
    this._checkpointPeek = null;
    cancel?.();
  }

  _clearLookBehind() {
    this._lookBehind = null;
  }

  _captureView() {
    const panoid = this.pano.getPano?.();
    const position = this.pano.getPosition?.();
    const pov = this.pano.getPov?.();
    if (!panoid || !position || !pov) return null;
    return {
      panoid,
      position: { lat: position.lat(), lng: position.lng() },
      pov: { heading: pov.heading ?? 0, pitch: pov.pitch ?? 0 },
      zoom: this.pano.getZoom?.() ?? DEFAULT_ZOOM
    };
  }

  _restoreCheckpointPeek(peek) {
    if (this._checkpointPeek !== peek || peek.returning) return;
    peek.returning = true;
    this._jumpToView(peek.source).then((ok) => {
      if (this._checkpointPeek !== peek || peek.token !== this._roundToken) return;
      this._cancelCheckpointJump = null;
      this._checkpointPeek = null;
      this._checkpointBusy = false;
      if (!ok) {
        const p = this.pano.getPosition?.();
        if (p) this._trail.push([{ lat: p.lat(), lng: p.lng() }]);
      }
      this.pano.focus?.();
    });
  }

  _jumpToView(view) {
    this._cancelTween();
    return new Promise((resolve) => {
      let done = false;
      let poll = 0;
      let timer = 0;
      let listeners = [];
      const cleanup = () => {
        clearInterval(poll);
        clearTimeout(timer);
        for (const listener of listeners) listener?.remove?.();
      };
      const finish = (ok) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(ok);
      };
      const check = () => {
        if (this.pano.getStatus?.() !== 'OK' ||
            this.pano.getPano?.() !== view.panoid ||
            !samePosition(this.pano.getPosition?.(), view.position)) return;
        this.pano.setPov(view.pov);
        this.pano.setZoom(view.zoom);
        finish(true);
      };

      listeners = [
        this.pano.addListener('pano_changed', check),
        this.pano.addListener('position_changed', check),
        this.pano.addListener('status_changed', check)
      ];
      poll = setInterval(check, 150);
      timer = setTimeout(() => finish(false), 12000);
      this._cancelCheckpointJump = () => finish(false);

      if (this.pano.getPano?.() !== view.panoid) this.pano.setPano(view.panoid);
      check();
    });
  }

  // Eased POV move (quadratic ease-out, shortest-angle), à la MMA's tweenPov.
  _tweenPov(heading, pitch) {
    this._cancelTween();
    const from = this.pano.getPov();
    let dh = from.heading - heading;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    const dp = (from.pitch ?? 0) - pitch;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / TWEEN_MS, 1);
      const e = t * (2 - t);
      this.pano.setPov({ heading: heading + dh * (1 - e), pitch: pitch + dp * (1 - e) });
      if (t < 1) this._tweenId = requestAnimationFrame(tick);
      else this._tweenId = 0;
    };
    this._tweenId = requestAnimationFrame(tick);
  }

  _cancelTween() {
    if (this._tweenId) cancelAnimationFrame(this._tweenId);
    this._tweenId = 0;
  }
}
