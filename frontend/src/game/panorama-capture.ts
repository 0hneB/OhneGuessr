const RENDER_TIMEOUT_MS = 5_000;
const FRAME_QUIET_MS = 400;
const SAMPLE_INTERVAL_MS = 100;
const HOST_OVERSCAN = 1.01;

export interface PanoramaCapture {
  blob: Blob;
  panoId: string;
  width: number;
  height: number;
}

export interface PanoramaCaptureOptions {
  width: number;
  height: number;
}

interface PanoramaView {
  panoId: string;
  pov: { heading: number; pitch: number };
  zoom: number;
}

export function fitCaptureSize(width: number, height: number, maxWidth = 1920, maxHeight = 1080) {
  if (![width, height, maxWidth, maxHeight].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Street View has no visible viewport');
  }
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

export function requestedCaptureSize(options: PanoramaCaptureOptions) {
  return fitCaptureSize(
    options.width,
    options.height,
    Math.min(1920, options.width),
    Math.min(1080, options.height)
  );
}

export async function capturePanoViewport(
  panorama: google.maps.StreetViewPanorama,
  viewportWidth: number,
  viewportHeight: number,
  options?: PanoramaCaptureOptions
): Promise<PanoramaCapture> {
  const view = panoramaView(panorama);
  const size = options ? requestedCaptureSize(options) : fitCaptureSize(viewportWidth, viewportHeight);
  const frame = await renderPanoView(view, size.width, size.height);
  return { blob: await canvasToBlob(frame), panoId: view.panoId, ...size };
}

function panoramaView(panorama: google.maps.StreetViewPanorama): PanoramaView {
  const panoId = panorama.getPano();
  const pov = panorama.getPov();
  const zoom = panorama.getZoom();
  if (!panoId || !pov || !Number.isFinite(pov.heading) || !Number.isFinite(pov.pitch) ||
      !Number.isFinite(zoom)) {
    throw new Error('Street View is not ready');
  }
  return { panoId, pov: { heading: pov.heading, pitch: pov.pitch }, zoom };
}

async function renderPanoView(view: PanoramaView, width: number, height: number) {
  const dpr = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? window.devicePixelRatio : 1;
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  Object.assign(container.style, {
    position: 'fixed', top: '0', left: '0', width: '1px', height: '1px',
    pointerEvents: 'none', overflow: 'hidden', zIndex: '-1'
  });
  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'absolute', top: '0', left: '0',
    width: `${width * HOST_OVERSCAN / dpr}px`,
    height: `${height * HOST_OVERSCAN / dpr}px`
  });
  container.appendChild(host);
  document.body.appendChild(container);

  let offscreen: google.maps.StreetViewPanorama | null = null;
  try {
    offscreen = new google.maps.StreetViewPanorama(host, {
      pano: view.panoId,
      pov: { ...view.pov },
      zoom: view.zoom,
      disableDefaultUI: true,
      linksControl: false,
      clickToGo: false,
      showRoadLabels: false,
      scrollwheel: false,
      motionTracking: false,
      visible: true
    });
    return await waitForStableFrame(host, width, height);
  } finally {
    offscreen?.setVisible(false);
    container.remove();
  }
}

export function frameFingerprint(pixels: Uint8ClampedArray): number | null {
  let hash = 2166136261;
  let min = 255;
  let max = 0;
  let visible = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    if (pixels[index + 3] > 0) visible++;
    min = Math.min(min, red, green, blue);
    max = Math.max(max, red, green, blue);
    hash = Math.imul(hash ^ red, 16777619);
    hash = Math.imul(hash ^ green, 16777619);
    hash = Math.imul(hash ^ blue, 16777619);
  }
  return visible > pixels.length / 8 && max - min > 4 ? hash >>> 0 : null;
}

async function waitForStableFrame(host: HTMLElement, width: number, height: number) {
  const sample = document.createElement('canvas');
  sample.width = 64;
  sample.height = 36;
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not inspect the Street View image');

  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  let latest: HTMLCanvasElement | null = null;
  let previous: number | null = null;
  let unchangedSince = 0;
  while (Date.now() < deadline) {
    await nextFrame();
    const canvas = sceneCanvas(host);
    if (canvas) {
      try {
        context.clearRect(0, 0, sample.width, sample.height);
        context.drawImage(canvas, 0, 0, sample.width, sample.height);
        const fingerprint = frameFingerprint(
          context.getImageData(0, 0, sample.width, sample.height).data
        );
        if (fingerprint !== null) {
          latest = drawScaled(canvas, width, height);
          const now = Date.now();
          if (fingerprint === previous && now - unchangedSince >= FRAME_QUIET_MS) return latest;
          if (fingerprint !== previous) {
            previous = fingerprint;
            unchangedSince = now;
          }
        }
      } catch { /* keep waiting while OpenSV swaps or clears its frame */ }
    }
    await delay(SAMPLE_INTERVAL_MS);
  }
  if (latest) return latest;
  throw new Error('Street View image is unavailable');
}

function sceneCanvas(host: HTMLElement) {
  const canvas = host.querySelector<HTMLCanvasElement>('canvas.widget-scene-canvas');
  return canvas && canvas.width > 0 && canvas.height > 0 ? canvas : null;
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function drawScaled(source: HTMLCanvasElement, width: number, height: number) {
  const scale = Math.max(width / source.width, height / source.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const context = output.getContext('2d');
  if (!context) throw new Error('Could not create the Street View image');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source,
    (source.width - sourceWidth) / 2,
    (source.height - sourceHeight) / 2,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height
  );
  return output;
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the Street View image'));
    }, 'image/png');
  });
}
