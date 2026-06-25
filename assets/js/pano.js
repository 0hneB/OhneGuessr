// Equirectangular panorama viewer (three.js). Camera at the centre of an inverted
// sphere textured with the stitched canvas. Drag to look (with inertia), scroll to
// zoom toward the cursor. Heading/pitch are authoritative so the compass reads them.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const FRICTION = 0.965;     // drag inertia decay per frame
const VEL_EPS = 0.004;      // inertia stops below this (deg/frame)
const EASE = 0.16;          // animateTo smoothing
const ZOOM_PAN_GAIN = 1.35; // pan toward the cursor while zooming
const ZOOM_SENS = 0.05;     // FOV degrees per wheel deltaY unit
const ZOOM_FRICTION = 0.8;  // zoom glide tail, not zoom distance
const ZOOM_VEL_MAX = 6;     // zoom velocity cap (deg/frame)
const ZOOM_VEL_EPS = 0.01;  // zoom stops below this
const DRAG_DEADZONE_PX = 3;
const INERTIA_RELEASE_MS = 120;
const MIN_FOV = 8;          // imagery softens past this
const MAX_FOV = 75;
const TILE_RADIUS = 500;    // match the base sphere to avoid z-fighting
const TILE_SUBDIVISIONS = 6;
const TILE_CACHE_LIMIT = 180;
const norm360 = (d) => ((d % 360) + 360) % 360;
const clampPitch = (p) => Math.max(-85, Math.min(85, p));
const shortestAngle = (d) => ((((d % 360) + 540) % 360) - 180);

function loadTileImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export class PanoViewer {
  constructor(container) {
    this.container = container;
    this.lon = 0;             // azimuth (deg)
    this.lat = 0;             // pitch (deg)
    this.fov = MAX_FOV;
    this.zoomVel = 0;         // zoom momentum (deg/frame)
    this.zoomAnchor = null;   // cursor {ux, uy} to zoom toward
    this.defaultLon = 0;
    this.defaultLat = 0;
    this.panoNorth = 0;       // texture's reference bearing for this pano
    this.velLon = 0;          // inertia velocity (deg/frame)
    this.velLat = 0;
    this.dragging = false;
    this.panEnabled = true;   // Panning setting
    this.zoomEnabled = true;  // Zooming setting
    this.target = null;       // animateTo {lon, lat, fov} or null
    this.onChange = null;     // callback(heading)
    this._lastHeading = null;
    this._tileSourceSeq = 0;
    this.tileSource = null;
    this.tileCache = new Map();
    this.tileCacheLimit = TILE_CACHE_LIMIT; // raised per-pano in setTileSource()
    this.tileQueue = [];
    this.tileLoading = 0;
    this.tileVisible = new Set();
    this._lastTileView = null;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.fov, this._aspect(), 0.1, 1100);

    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1); // view from the inside
    this.material = new THREE.MeshBasicMaterial();
    this.scene.add(new THREE.Mesh(geometry, this.material));
    this.tileGroup = new THREE.Group();
    this.scene.add(this.tileGroup);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.domElement.style.cursor = 'pointer';
    container.appendChild(this.renderer.domElement);

    this._bindControls();
    window.addEventListener('resize', () => this._resize());
    this.renderer.setAnimationLoop(() => this._animate());
  }

  // Swap the panorama texture; the view is preserved.
  setPanorama(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // No mipmaps avoids a seam at the wrap; anisotropy keeps grazing angles sharp.
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    if (this.material.map) this.material.map.dispose();
    this.material.map = tex;
    this.material.needsUpdate = true;
  }

  // Drop all tiles for the current pano. Called at each round load.
  clearTileSource() {
    this._tileSourceSeq++;
    this.tileSource = null;
    this.tileCacheLimit = TILE_CACHE_LIMIT;
    this.tileQueue = [];
    this.tileLoading = 0;
    this.tileVisible.clear();
    this._lastTileView = null;
    for (const entry of this.tileCache.values()) this._disposeTile(entry);
    this.tileCache.clear();
  }

  // High-res tiled overlay above the base texture. Only tiles near the camera
  // direction load, so the view sharpens where you look.
  setTileSource({ loc, zoom, urlForTile, tileSize = CONFIG.TILE_SIZE }) {
    this.clearTileSource();
    if (!loc || !urlForTile || !Number.isFinite(zoom)) return;

    const scale = Math.pow(2, CONFIG.MAX_PANO_ZOOM - zoom);
    const width = Math.max(tileSize, Math.round(loc.w / scale));
    const height = Math.max(tileSize / 2, Math.round(loc.h / scale));
    this.tileSource = {
      id: this._tileSourceSeq,
      zoom,
      urlForTile,
      tileSize,
      width,
      height,
      cols: Math.ceil(width / tileSize),
      rows: Math.ceil(height / tileSize)
    };
    // Cache the whole pano so panning never refetches; bounded and cleared per round.
    this.tileCacheLimit = this.tileSource.cols * this.tileSource.rows;
    this._updateTileVisibility(true);
  }

  // Convert between compass heading and internal azimuth. panoNorth removes the
  // per-pano offset; HEADING_SIGN/HEADING_OFFSET are the global calibration.
  _headingToLon(h) {
    return CONFIG.HEADING_SIGN * (h - this.panoNorth - CONFIG.HEADING_OFFSET);
  }
  _lonToHeading(lon) {
    return norm360(this.panoNorth + CONFIG.HEADING_SIGN * lon + CONFIG.HEADING_OFFSET);
  }

  // Starting view for this location (and where R returns to).
  setDefaultView(heading = 0, pitch = 0, north = 0) {
    this.panoNorth = north;
    this.defaultLon = this._headingToLon(heading);
    this.defaultLat = clampPitch(pitch);
  }

  resetView() {
    this.lon = this.defaultLon;
    this.lat = this.defaultLat;
    this.fov = MAX_FOV;
    this.zoomVel = 0;
    this.velLon = this.velLat = 0;
  }

  getHeading() {
    return this._lonToHeading(this.lon);
  }

  // When off, drop any in-flight drag and inertia.
  setPanEnabled(on) {
    this.panEnabled = !!on;
    if (!this.panEnabled) {
      this.dragging = false;
      this.velLon = this.velLat = 0;
    }
    this.renderer.domElement.style.cursor = this.panEnabled ? 'pointer' : 'default';
  }

  // When off, drop any zoom momentum.
  setZoomEnabled(on) {
    this.zoomEnabled = !!on;
    if (!this.zoomEnabled) this.zoomVel = 0;
  }

  // Ease to an absolute heading/pitch (deg).
  animateTo(heading, pitch, fov = this.fov) {
    const desiredLon = this._headingToLon(heading);
    this.velLon = this.velLat = 0;
    this.zoomVel = 0;
    this.target = {
      lon: this.lon + shortestAngle(desiredLon - this.lon), // shortest path
      lat: clampPitch(pitch),
      fov: Math.max(MIN_FOV, Math.min(MAX_FOV, fov))
    };
  }

  faceNorth() { this.animateTo(0, 0); }
  faceNorthDown() { this.animateTo(0, -85); }

  // Ease fully in (direction > 0) or out (< 0).
  zoomFull(direction) {
    if (!this.zoomEnabled || !direction) return;
    this.animateTo(this.getHeading(), this.lat, direction > 0 ? MIN_FOV : MAX_FOV);
  }

  _aspect() {
    return this.container.clientWidth / this.container.clientHeight;
  }

  _resize() {
    this.camera.aspect = this._aspect();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this._updateTileVisibility(true);
  }

  _bindControls() {
    const dom = this.renderer.domElement;
    let px = 0, py = 0, plon = 0, plat = 0;
    let moved = false, lastMoveAt = 0;
    dom.style.touchAction = 'none';

    dom.addEventListener('pointerdown', (e) => {
      if (!this.panEnabled) return;
      this.dragging = true;
      this.target = null;
      this.velLon = this.velLat = 0;
      px = e.clientX; py = e.clientY;
      plon = this.lon; plat = this.lat;
      moved = false;
      lastMoveAt = 0;
      dom.style.cursor = 'all-scroll';
      dom.setPointerCapture(e.pointerId);
    });

    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - px;
      const dy = e.clientY - py;
      if (!moved && dx * dx + dy * dy < DRAG_DEADZONE_PX * DRAG_DEADZONE_PX) {
        this.velLon = this.velLat = 0;
        return;
      }

      const wasMoved = moved;
      moved = true;
      lastMoveAt = performance.now();
      const k = 0.1 * (this.fov / MAX_FOV);
      const newLon = -dx * k + plon;
      const newLat = clampPitch(dy * k + plat);
      // First move past the deadzone positions the view; later moves set inertia.
      this.velLon = wasMoved ? newLon - this.lon : 0;
      this.velLat = wasMoved ? newLat - this.lat : 0;
      this.lon = newLon;
      this.lat = newLat;
    });

    const end = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (!moved || performance.now() - lastMoveAt > INERTIA_RELEASE_MS) {
        this.velLon = this.velLat = 0;
      }
      dom.style.cursor = 'pointer';
      try { dom.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);

    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.zoomEnabled) return;
      this.target = null;
      const rect = dom.getBoundingClientRect();
      // Each notch adds zoom velocity that eases to a stop. The (1 - friction)
      // factor keeps travel per notch constant regardless of ZOOM_FRICTION.
      const impulse = e.deltaY * ZOOM_SENS * (1 - ZOOM_FRICTION);
      this.zoomVel = Math.max(-ZOOM_VEL_MAX, Math.min(ZOOM_VEL_MAX, this.zoomVel + impulse));
      // Cursor in normalised coords, so the glide zooms toward it.
      this.zoomAnchor = {
        ux: (e.clientX - rect.left - rect.width / 2) / (rect.width / 2),
        uy: (rect.height / 2 - (e.clientY - rect.top)) / (rect.height / 2)
      };
    }, { passive: false });
  }

  _animate() {
    if (this.target && !this.dragging) {
      // Ease toward an animateTo target.
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
    } else {
      if (!this.dragging &&
          (Math.abs(this.velLon) > VEL_EPS || Math.abs(this.velLat) > VEL_EPS)) {
        // Inertial glide after release.
        this.lon += this.velLon;
        this.lat = clampPitch(this.lat + this.velLat);
        this.velLon *= FRICTION;
        this.velLat *= FRICTION;
        if (Math.abs(this.velLon) <= VEL_EPS && Math.abs(this.velLat) <= VEL_EPS) {
          this.velLon = this.velLat = 0;
        }
      }
      this._applyZoomMomentum();
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
    this._updateTileVisibility();
    this.renderer.render(this.scene, this.camera);

    if (this.onChange) {
      const h = this.getHeading();
      if (this._lastHeading === null || Math.abs(h - this._lastHeading) > 0.2) {
        this._lastHeading = h;
        this.onChange(h);
      }
    }
  }

  // Glide the FOV with decaying momentum, keeping the cursor point fixed.
  _applyZoomMomentum() {
    if (Math.abs(this.zoomVel) < ZOOM_VEL_EPS) { this.zoomVel = 0; return; }
    let fovNew = this.fov + this.zoomVel;
    if (fovNew <= MIN_FOV) { fovNew = MIN_FOV; this.zoomVel = 0; }
    else if (fovNew >= MAX_FOV) { fovNew = MAX_FOV; this.zoomVel = 0; }

    const a = this.zoomAnchor;
    if (a) {
      const aspect = this._aspect();
      const tanOld = Math.tan(THREE.MathUtils.degToRad(this.fov) / 2);
      const tanNew = Math.tan(THREE.MathUtils.degToRad(fovNew) / 2);
      const deg = THREE.MathUtils.radToDeg;
      const dLon = deg(Math.atan(a.ux * tanOld * aspect)) - deg(Math.atan(a.ux * tanNew * aspect));
      const dLat = deg(Math.atan(a.uy * tanOld)) - deg(Math.atan(a.uy * tanNew));
      this.lon += ZOOM_PAN_GAIN * dLon;
      this.lat = clampPitch(this.lat + ZOOM_PAN_GAIN * dLat);
    }
    this.fov = fovNew;
    this.zoomVel *= ZOOM_FRICTION;
  }

  _horizontalFov() {
    const v = THREE.MathUtils.degToRad(this.fov);
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(v / 2) * this._aspect()));
  }

  _updateTileVisibility(force = false) {
    const s = this.tileSource;
    if (!s) return;
    const view = { lon: norm360(this.lon), lat: this.lat, fov: this.fov };
    if (!force && this._lastTileView) {
      const dLon = Math.abs(shortestAngle(view.lon - this._lastTileView.lon));
      const dLat = Math.abs(view.lat - this._lastTileView.lat);
      const dFov = Math.abs(view.fov - this._lastTileView.fov);
      if (dLon < 3 && dLat < 3 && dFov < 1.5) return;
    }
    this._lastTileView = view;

    const hRadius = this._horizontalFov() * 0.65 + 28;
    const vRadius = this.fov * 0.65 + 22;
    const visible = [];
    for (let y = 0; y < s.rows; y++) {
      for (let x = 0; x < s.cols; x++) {
        const b = this._tileBounds(x, y);
        const dx = Math.abs(shortestAngle(b.lon - view.lon));
        const dy = Math.abs(b.pitch - view.lat);
        if (dx > hRadius + b.lonSpan / 2 || dy > vRadius + b.pitchSpan / 2) continue;
        visible.push({
          key: `${s.zoom}/${x}/${y}`,
          x,
          y,
          priority: dx * 1.25 + dy
        });
      }
    }
    visible.sort((a, b) => a.priority - b.priority);

    this.tileVisible = new Set(visible.map((t) => t.key));
    for (const tile of visible) this._ensureTile(tile);
    this._pumpTileQueue();
    this._pruneTileCache();
  }

  _tileBounds(x, y) {
    const s = this.tileSource;
    const x0 = x * s.tileSize;
    const y0 = y * s.tileSize;
    const w = Math.min(s.tileSize, s.width - x0);
    const h = Math.min(s.tileSize, s.height - y0);
    return {
      lon: norm360(((x0 + w / 2) / s.width) * 360),
      pitch: 90 - ((y0 + h / 2) / s.height) * 180,
      lonSpan: (w / s.width) * 360,
      pitchSpan: (h / s.height) * 180
    };
  }

  _ensureTile(tile) {
    let entry = this.tileCache.get(tile.key);
    if (entry) {
      entry.lastUsed = performance.now();
      entry.priority = tile.priority;
      return;
    }
    entry = {
      key: tile.key,
      x: tile.x,
      y: tile.y,
      priority: tile.priority,
      lastUsed: performance.now(),
      status: 'queued',
      sourceId: this.tileSource.id
    };
    this.tileCache.set(tile.key, entry);
    this.tileQueue.push(entry);
  }

  _pumpTileQueue() {
    const s = this.tileSource;
    if (!s) return;
    const limit = Math.max(1, Math.min(CONFIG.TILE_LOAD_CONCURRENCY || 8, 16));
    this.tileQueue.sort((a, b) => a.priority - b.priority);
    while (this.tileLoading < limit && this.tileQueue.length) {
      const entry = this.tileQueue.shift();
      if (!entry || entry.status !== 'queued' || entry.sourceId !== s.id) continue;
      entry.status = 'loading';
      this.tileLoading++;
      this._loadTile(entry, s.id);
    }
  }

  async _loadTile(entry, sourceId) {
    const s = this.tileSource;
    const url = s?.urlForTile(entry.x, entry.y, s.zoom);
    const img = url ? await loadTileImage(url) : null;
    if (!this.tileSource || this.tileSource.id !== sourceId) return;
    this.tileLoading = Math.max(0, this.tileLoading - 1);

    if (!img) {
      entry.status = 'error';
      this._pumpTileQueue();
      return;
    }

    const texture = new THREE.Texture(img);
    texture.colorSpace = THREE.SRGBColorSpace;
    // Mipmaps are safe per-tile (clamped 512px images) and reduce shimmer while
    // panning; the wrapping base texture can't use them without a seam.
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      // Paint over the base sphere with no depth test so equal radii don't z-fight.
      depthWrite: false,
      depthTest: false
    });
    const mesh = new THREE.Mesh(this._tileGeometry(entry.x, entry.y), material);
    mesh.renderOrder = 1;
    this.tileGroup.add(mesh);

    entry.texture = texture;
    entry.material = material;
    entry.mesh = mesh;
    entry.status = 'ready';
    entry.lastUsed = performance.now();
    this._pumpTileQueue();
    this._pruneTileCache();
  }

  _tileGeometry(x, y) {
    const s = this.tileSource;
    const x0 = x * s.tileSize;
    const y0 = y * s.tileSize;
    const x1 = Math.min(x0 + s.tileSize, s.width);
    const y1 = Math.min(y0 + s.tileSize, s.height);
    const u0 = x0 / s.width;
    const u1 = x1 / s.width;
    const v0 = y0 / s.height;
    const v1 = y1 / s.height;

    const positions = [];
    const uvs = [];
    const indices = [];
    const n = TILE_SUBDIVISIONS;
    for (let iy = 0; iy <= n; iy++) {
      const tv = iy / n;
      const gv = v0 + (v1 - v0) * tv;
      const theta = gv * Math.PI;
      for (let ix = 0; ix <= n; ix++) {
        const tu = ix / n;
        const gu = u0 + (u1 - u0) * tu;
        const phi = gu * Math.PI * 2;
        positions.push(
          TILE_RADIUS * Math.cos(phi) * Math.sin(theta),
          TILE_RADIUS * Math.cos(theta),
          TILE_RADIUS * Math.sin(phi) * Math.sin(theta)
        );
        uvs.push(tu, 1 - tv);
      }
    }
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        const a = iy * (n + 1) + ix;
        const b = a + 1;
        const c = a + (n + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  _pruneTileCache() {
    if (this.tileCache.size <= this.tileCacheLimit) return;
    const removable = [...this.tileCache.values()]
      .filter((entry) => !this.tileVisible.has(entry.key) && entry.status !== 'loading')
      .sort((a, b) => a.lastUsed - b.lastUsed);
    while (this.tileCache.size > this.tileCacheLimit && removable.length) {
      const entry = removable.shift();
      this.tileCache.delete(entry.key);
      this._disposeTile(entry);
    }
  }

  _disposeTile(entry) {
    entry.status = 'disposed';
    if (entry.mesh) this.tileGroup.remove(entry.mesh);
    entry.mesh?.geometry?.dispose();
    entry.material?.dispose();
    entry.texture?.dispose();
  }
}
