// Fetches Google Street View panorama tiles (keyless internal endpoint) and
// stitches them into a single equirectangular canvas usable as a texture.
import { CONFIG } from './config.js';

const TILE = CONFIG.TILE_SIZE;

// Tile URL by panorama id + tile coords + zoom. Works from a browser because
// the browser sends a normal User-Agent (curl/no-UA gets a 403). CORS headers
// are returned, so the resulting canvas is not tainted (safe for WebGL).
export function tileUrl(panoid, x, y, zoom) {
  return `https://streetviewpixels-pa.googleapis.com/v1/tile` +
    `?cb_client=maps_sv.tactile&panoid=${encodeURIComponent(panoid)}` +
    `&x=${x}&y=${y}&zoom=${zoom}&nbt=1&fover=2`;
}

// Largest texture the GPU can hold (cached). A panorama wider than this would
// fail to upload as a WebGL texture, so we step the zoom down until it fits.
let _maxTex;
function maxTextureSize() {
  if (_maxTex) return _maxTex;
  try {
    const gl = document.createElement('canvas').getContext('webgl') ||
      document.createElement('canvas').getContext('experimental-webgl');
    _maxTex = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096;
  } catch {
    _maxTex = 4096;
  }
  return _maxTex || 4096;
}

function clampZoomToGPU(loc, zoom) {
  const cap = maxTextureSize();
  let z = zoom;
  while (z > 0 && loc.w / Math.pow(2, CONFIG.MAX_PANO_ZOOM - z) > cap) z--;
  return z;
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // missing/edge tiles -> skip
    img.src = url;
  });
}

// Resolve the nearest panorama (id + dimensions + exact coords) for a lat/lng,
// in the browser. SingleImageSearch is JSONP, so a <script> injection sidesteps
// CORS. Used for uploaded location lists that lack w/h.
let _jsonpId = 0;
export function resolvePano(lat, lng, radius = 50) {
  const pb = `!1m5!1sapiv3!5sUS!11m2!1m1!1b0!2m4!1m2!3d${lat}!4d${lng}!2d${radius}` +
    '!3m10!2m2!1sen!2sUS!9m1!1e2!11m4!1m3!1e2!2b1!3e2!4m10!1e1!1e2!1e3!1e4!1e8!1e6!5m1!1e2!6m1!1e2';
  return new Promise((resolve) => {
    const cb = `__svcb_${_jsonpId++}`;
    const script = document.createElement('script');
    const finish = (val) => {
      try { delete window[cb]; } catch { window[cb] = undefined; }
      script.remove();
      clearTimeout(timer);
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), 8000);
    window[cb] = (data) => {
      try {
        const txt = JSON.stringify(data);
        const id = txt.match(/\[2,"([\w-]{18,})"\]/);
        const coord = txt.match(/null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/);
        const dims = txt.match(/\[2,2,\[(\d+),(\d+)\]/); // [height, width] at max zoom
        // Orientation triple after the coords; col0 is the panorama heading.
        const ori = txt.match(/null,null,-?\d[\d.]*,-?\d[\d.]*\],\[[^\]]*\],\[(-?\d[\d.]*),/);
        if (id && coord) {
          finish({
            panoid: id[1],
            lat: parseFloat(coord[1]),
            lng: parseFloat(coord[2]),
            w: dims ? parseInt(dims[2], 10) : 16384,
            h: dims ? parseInt(dims[1], 10) : 8192,
            north: ori ? parseFloat(ori[1]) : 0
          });
        } else finish(null);
      } catch { finish(null); }
    };
    script.onerror = () => finish(null);
    script.src = `https://maps.googleapis.com/maps/api/js/GeoPhotoService.SingleImageSearch?pb=${pb}&callback=${cb}`;
    document.head.appendChild(script);
  });
}

// Builds an equirectangular canvas for a location at CONFIG.RENDER_ZOOM.
// loc.w / loc.h are the full panorama dimensions at CONFIG.MAX_PANO_ZOOM.
export async function buildPanoCanvas(loc, zoom = CONFIG.RENDER_ZOOM) {
  zoom = clampZoomToGPU(loc, zoom);
  const scale = Math.pow(2, CONFIG.MAX_PANO_ZOOM - zoom);
  const width = Math.max(TILE, Math.round(loc.w / scale));
  const height = Math.max(TILE / 2, Math.round(loc.h / scale));
  const cols = Math.ceil(width / TILE);
  const rows = Math.ceil(height / TILE);

  // Draw tiles onto an oversized grid canvas, then crop to true pano size so
  // the texture keeps an exact 2:1 ratio for correct spherical mapping.
  const grid = document.createElement('canvas');
  grid.width = cols * TILE;
  grid.height = rows * TILE;
  const gctx = grid.getContext('2d');

  const jobs = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      jobs.push(loadImage(tileUrl(loc.panoid, x, y, zoom)).then((img) => {
        if (img) gctx.drawImage(img, x * TILE, y * TILE);
      }));
    }
  }
  await Promise.all(jobs);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  out.getContext('2d').drawImage(grid, 0, 0);
  return out;
}
