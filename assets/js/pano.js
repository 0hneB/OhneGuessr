// Panorama viewer backed by Google's real Street View (the vendored, key-less Maps
// JS API in assets/js/vendor/opensv/opensv.js). Movement mode is set via setMode():
//   moving — walk (click the road / arrows), pan, and zoom
//   nm     — no moving; pan and zoom allowed
//   nmpz   — no move, pan, or zoom (locked to the spawn view)

const OPENSV_SRC = 'assets/js/vendor/opensv/opensv.js';
const ZOOM_IN = 3;     // google SV zoom level for "zoomed in"
const TWEEN_MS = 160;  // matches MMA's tweenPov feel
// Keys Street View uses to walk; blocked outside moving mode.
const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);

let loadPromise = null;

// Force preserveDrawingBuffer so the pano canvas can be read back (thumbnails) and so
// screenshots aren't a cleared/black buffer. Must run before the WebGL context exists.
function patchPreserveDrawingBuffer() {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === 'webgl' || type === 'webgl2') attrs = { ...attrs, preserveDrawingBuffer: true };
    return orig.call(this, type, attrs);
  };
}

// Inject the vendored Maps JS API once. No tile-host rewrite => tiles hit Google
// directly, which works in a plain browser (verified by the throwaway prototype).
export function loadOpenSV() {
  if (window.google?.maps?.StreetViewPanorama) return Promise.resolve(window.google);
  if (loadPromise) return loadPromise;
  patchPreserveDrawingBuffer();
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = OPENSV_SRC;
    s.onload = async () => {
      const t0 = Date.now();
      while (!window.google?.maps?.StreetViewPanorama) {
        if (Date.now() - t0 > 10000) return reject(new Error('opensv loaded but StreetViewPanorama missing'));
        await new Promise((r) => setTimeout(r, 50));
      }
      console.log('[opensv] Street View API ready');
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

  // faceNorth/zoom pan or zoom the view, so they no-op in nmpz (the locked mode).
  faceNorth() { if (this.mode !== 'nmpz') this._tweenPov(0, 0); }
  faceNorthDown() { if (this.mode !== 'nmpz') this._tweenPov(0, -90); }

  zoomFull(direction) {
    if (!direction || this.mode === 'nmpz') return;
    this.pano.setZoom(direction > 0 ? ZOOM_IN : 0);
  }

  // Load a location by stored panoid (falls back to lat/lng). Resolves true once
  // imagery is up, false on no-coverage / error / timeout / abort.
  showLocation(loc, { signal } = {}) {
    const prevPano = this.pano.getPano?.() || null;
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => { if (done) return; done = true; cleanup(); resolve(ok); };

      // Polled, not just event-driven: status_changed doesn't fire when the status
      // stays OK across rounds, and event order isn't guaranteed, so the events alone
      // miss successful loads. Success = a *new* pano showing with status OK.
      const check = () => {
        const s = this.pano.getStatus?.();
        if (s === 'ZERO_RESULTS' || s === 'UNKNOWN_ERROR') { finish(false); return; }
        if (s !== 'OK') return;
        const cur = this.pano.getPano?.() || null;
        if (cur && (cur !== prevPano || cur === loc.panoid)) {
          this._startPanoId = cur; // origin for resetView
          finish(true);
        }
      };
      const panoListener = this.pano.addListener('pano_changed', check);
      const statusListener = this.pano.addListener('status_changed', check);
      const poll = setInterval(check, 150);
      const timer = setTimeout(() => finish(false), 12000);
      const onAbort = () => finish(false);
      signal?.addEventListener('abort', onAbort, { once: true });

      const cleanup = () => {
        clearInterval(poll);
        clearTimeout(timer);
        panoListener?.remove?.();
        statusListener?.remove?.();
        signal?.removeEventListener('abort', onAbort);
      };

      this._trail = []; // fresh round; the spawn is recorded by position_changed
      this.pano.setPov({ heading: loc.heading ?? 0, pitch: loc.pitch ?? 0 });
      this.pano.setZoom(1);
      if (loc.panoid) this.pano.setPano(loc.panoid);
      else this.pano.setPosition({ lat: loc.lat, lng: loc.lng });
      this.pano.setVisible(true);
      // Focus so drag-look (and, in moving, keyboard walking) works. nmpz is locked,
      // so leave it unfocused; the overlay and key-block handle the rest.
      if (this.mode !== 'nmpz') this.pano.focus?.();
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
