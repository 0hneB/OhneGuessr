// Panorama viewer backed by Google's real Street View (the vendored, key-less Maps
// JS API in assets/js/vendor/opensv/opensv.js). Movement mode is set via setMode():
//   moving — walk (click the road / arrows), pan, and zoom
//   nm     — no moving; pan and zoom allowed
//   nmpz   — no move, pan, or zoom (locked to the spawn view)

const OPENSV_SRC = 'assets/js/vendor/opensv/opensv.js';
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
    this._tweenId = 0;
    this._startPanoId = null;   // the round's origin pano, so resetView can walk back
    this._trail = [];           // {lat,lng} positions walked this round (Moving mode)
    this._trailActive = false;  // preparation must never look like player movement
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
      if (!this._trailActive) return;
      const p = this.pano.getPosition?.();
      if (!p) return;
      const point = { lat: p.lat(), lng: p.lng() };
      const last = this._trail[this._trail.length - 1];
      if (last && last.lat === point.lat && last.lng === point.lng) return;
      this._trail.push(point);
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
    this.pano.setOptions({ clickToGo: moving, linksControl: moving, scrollwheel: !nmpz });
    this._lock.style.pointerEvents = nmpz ? 'auto' : 'none';
  }

  // Starting view for this location (and where R returns to).
  setDefaultView(heading = 0, pitch = 0) {
    this.defaultHeading = heading;
    this.defaultPitch = pitch;
  }

  resetView() {
    this._cancelTween();
    // In moving mode, R also returns to where the round started.
    if (this._startPanoId && this.pano.getPano() !== this._startPanoId) {
      this.pano.setPano(this._startPanoId);
    }
    this.pano.setPov({ heading: this.defaultHeading, pitch: this.defaultPitch });
    this.pano.setZoom(1);
  }

  getHeading() { return this.pano.getPov().heading; }
  get lat() { return this.pano.getPov().pitch; }

  // Positions walked this round (≥2 points only when the player actually moved).
  getTrail() { return this._trail.slice(); }

  // Turn a prepared panorama into the active round. Preparation may happen while
  // the result screen covers the viewer, so reset the trail and focus only now.
  beginRound(loc) {
    this.setDefaultView(loc.heading ?? 0, loc.pitch ?? 0);
    this._trail = [];
    const p = this.pano.getPosition?.();
    if (p) this._trail.push({ lat: p.lat(), lng: p.lng() });
    this._trailActive = true;
    if (this.mode !== 'nmpz') this.pano.focus?.();
  }

  // faceNorth/zoom pan or zoom the view, so they no-op in nmpz (the locked mode).
  faceNorth() { if (this.mode !== 'nmpz') this._tweenPov(0, 0); }
  faceNorthDown() { if (this.mode !== 'nmpz') this._tweenPov(0, -90); }

  zoomFull(direction) {
    if (!direction || this.mode === 'nmpz') return;
    this.pano.setZoom(direction > 0 ? ZOOM_IN : 0);
  }

  // Resolve one exact pano before touching the shared viewer. A failed lookup may
  // finish late, but its promise can no longer move a newer replacement location.
  showLocation(loc, { signal, focus = true } = {}) {
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
          this.pano.setZoom(1);
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
