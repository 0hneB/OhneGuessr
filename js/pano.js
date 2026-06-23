// Equirectangular panorama viewer (three.js only). Camera sits at the centre of
// an inverted sphere textured with the stitched Street View canvas.
//
// Controls aim to match Google Street View / GeoGuessr feel:
//  - drag to look, with inertia (glide) on release
//  - scroll to zoom *towards the cursor* (the point under the cursor stays put,
//    so the view pans/tilts that way as you zoom in)
//  - heading/pitch are the source of truth so a compass can read them directly
import * as THREE from 'three';
import { CONFIG } from './config.js';

const FRICTION = 0.965;   // inertia decay per frame after releasing a drag
const VEL_EPS = 0.004;    // below this angular speed (deg/frame) inertia stops
const EASE = 0.16;        // smoothing factor for animateTo (N key, etc.)
const ZOOM_PAN_GAIN = 1.8; // exaggerate the pan-toward-cursor while zooming
const MIN_FOV = 30;
const MAX_FOV = 75;
const norm360 = (d) => ((d % 360) + 360) % 360;
const clampPitch = (p) => Math.max(-85, Math.min(85, p));
// Shortest signed angular difference (deg) in [-180, 180].
const shortestAngle = (d) => ((((d % 360) + 540) % 360) - 180);

export class PanoViewer {
  constructor(container) {
    this.container = container;
    this.lon = 0;          // internal azimuth (deg)
    this.lat = 0;          // internal elevation / pitch (deg)
    this.fov = MAX_FOV;
    this.defaultLon = 0;
    this.defaultLat = 0;
    this.panoNorth = 0;    // compass bearing the texture's reference faces (per pano)
    this.velLon = 0;       // inertia velocity (deg/frame)
    this.velLat = 0;
    this.dragging = false;
    this.target = null;    // {lon, lat, fov} for smooth animateTo, else null
    this.onChange = null;  // callback(headingDegrees)
    this._lastHeading = null;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.fov, this._aspect(), 0.1, 1100);

    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1); // view from the inside
    this.material = new THREE.MeshBasicMaterial();
    this.scene.add(new THREE.Mesh(geometry, this.material));

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.domElement.style.cursor = 'pointer';
    container.appendChild(this.renderer.domElement);

    this._bindControls();
    window.addEventListener('resize', () => this._resize());
    this.renderer.setAnimationLoop(() => this._animate());
  }

  // Swap the displayed panorama texture only; the current view is preserved.
  setPanorama(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Linear (no mipmaps) avoids a seam at the equirectangular wrap; anisotropy
    // keeps the ground/buildings sharp when viewed at a grazing angle.
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    if (this.material.map) this.material.map.dispose();
    this.material.map = tex;
    this.material.needsUpdate = true;
  }

  // Map between true compass heading and internal azimuth. `panoNorth` removes
  // the per-pano car-direction offset; HEADING_SIGN/HEADING_OFFSET (config) are
  // the one global calibration for the texture convention.
  _headingToLon(h) {
    return CONFIG.HEADING_SIGN * (h - this.panoNorth - CONFIG.HEADING_OFFSET);
  }
  _lonToHeading(lon) {
    return norm360(this.panoNorth + CONFIG.HEADING_SIGN * lon + CONFIG.HEADING_OFFSET);
  }

  // The view this location starts at (and that 'R' returns to). `north` is the
  // panorama's heading from metadata; `heading` is the desired true bearing.
  setDefaultView(heading = 0, pitch = 0, north = 0) {
    this.panoNorth = north;
    this.defaultLon = this._headingToLon(heading);
    this.defaultLat = clampPitch(pitch);
  }

  resetView() {
    this.lon = this.defaultLon;
    this.lat = this.defaultLat;
    this.fov = MAX_FOV;
    this.velLon = this.velLat = 0;
  }

  getHeading() {
    return this._lonToHeading(this.lon);
  }

  // Smoothly animate to an absolute heading/pitch (deg). fov optional.
  animateTo(heading, pitch, fov = this.fov) {
    const desiredLon = this._headingToLon(heading);
    this.velLon = this.velLat = 0;
    this.target = {
      lon: this.lon + shortestAngle(desiredLon - this.lon), // shortest path
      lat: clampPitch(pitch),
      fov: Math.max(MIN_FOV, Math.min(MAX_FOV, fov))
    };
  }

  faceNorth() { this.animateTo(0, 0); }
  faceNorthDown() { this.animateTo(0, -85); }

  _aspect() {
    return this.container.clientWidth / this.container.clientHeight;
  }

  _resize() {
    this.camera.aspect = this._aspect();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  _bindControls() {
    const dom = this.renderer.domElement;
    let px = 0, py = 0, plon = 0, plat = 0;
    dom.style.touchAction = 'none';

    dom.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.target = null;
      this.velLon = this.velLat = 0;
      px = e.clientX; py = e.clientY;
      plon = this.lon; plat = this.lat;
      dom.style.cursor = 'all-scroll';
      dom.setPointerCapture(e.pointerId);
    });

    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const k = 0.1 * (this.fov / MAX_FOV);
      const newLon = (px - e.clientX) * k + plon;
      const newLat = clampPitch((e.clientY - py) * k + plat);
      this.velLon = newLon - this.lon; // remember last-frame speed for inertia
      this.velLat = newLat - this.lat;
      this.lon = newLon;
      this.lat = newLat;
    });

    const end = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      dom.style.cursor = 'pointer';
      try { dom.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);

    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.target = null;
      const rect = dom.getBoundingClientRect();
      const fovNew = Math.max(MIN_FOV, Math.min(MAX_FOV, this.fov + e.deltaY * 0.05));
      if (fovNew === this.fov) return;

      // Keep the world point under the cursor fixed: shift lon/lat by the change
      // in the cursor's angular offset between the old and new fov.
      const aspect = this._aspect();
      const ux = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
      const uy = (rect.height / 2 - (e.clientY - rect.top)) / (rect.height / 2);
      const tanOld = Math.tan(THREE.MathUtils.degToRad(this.fov) / 2);
      const tanNew = Math.tan(THREE.MathUtils.degToRad(fovNew) / 2);
      const deg = THREE.MathUtils.radToDeg;
      const dLon = deg(Math.atan(ux * tanOld * aspect)) - deg(Math.atan(ux * tanNew * aspect));
      const dLat = deg(Math.atan(uy * tanOld)) - deg(Math.atan(uy * tanNew));
      this.lon += ZOOM_PAN_GAIN * dLon;
      this.lat = clampPitch(this.lat + ZOOM_PAN_GAIN * dLat);
      this.fov = fovNew;
    }, { passive: false });
  }

  _animate() {
    if (this.target && !this.dragging) {
      // Ease toward an animateTo() target (N key, etc.).
      this.lon += (this.target.lon - this.lon) * EASE;
      this.lat += (this.target.lat - this.lat) * EASE;
      this.fov += (this.target.fov - this.fov) * EASE;
      if (Math.abs(this.target.lon - this.lon) < 0.05 &&
          Math.abs(this.target.lat - this.lat) < 0.05 &&
          Math.abs(this.target.fov - this.fov) < 0.05) {
        this.lon = this.target.lon;
        this.lat = this.target.lat;
        this.fov = this.target.fov;
        this.target = null;
      }
    } else if (!this.dragging &&
        (Math.abs(this.velLon) > VEL_EPS || Math.abs(this.velLat) > VEL_EPS)) {
      // Apply inertial glide after a drag release.
      this.lon += this.velLon;
      this.lat = clampPitch(this.lat + this.velLat);
      this.velLon *= FRICTION;
      this.velLat *= FRICTION;
      if (Math.abs(this.velLon) <= VEL_EPS && Math.abs(this.velLat) <= VEL_EPS) {
        this.velLon = this.velLat = 0;
      }
    }

    const phi = THREE.MathUtils.degToRad(90 - this.lat);
    const theta = THREE.MathUtils.degToRad(this.lon);
    this.camera.lookAt(
      500 * Math.sin(phi) * Math.cos(theta),
      500 * Math.cos(phi),
      500 * Math.sin(phi) * Math.sin(theta)
    );
    if (this.camera.fov !== this.fov) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);

    if (this.onChange) {
      const h = this.getHeading();
      if (this._lastHeading === null || Math.abs(h - this._lastHeading) > 0.2) {
        this._lastHeading = h;
        this.onChange(h);
      }
    }
  }
}
