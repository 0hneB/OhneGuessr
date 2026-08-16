const RENDER_TIMEOUT_MS = 5_000;

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

interface CapturedFrame {
  image: HTMLCanvasElement;
  width: number;
  height: number;
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
  host: HTMLElement,
  viewportWidth: number,
  viewportHeight: number,
  options?: PanoramaCaptureOptions
): Promise<PanoramaCapture> {
  const panoId = panorama.getPano();
  if (!panoId) throw new Error('Street View is not ready');

  const requested = options ? requestedCaptureSize(options) : null;
  const live = sceneCanvas(host);
  const size = requested || fitCaptureSize(
    viewportWidth, viewportHeight,
    Math.min(1920, live?.width ?? 1920), Math.min(1080, live?.height ?? 1080)
  );
  const current = live && live.width >= size.width && live.height >= size.height
    ? copyFrame(host, size) : null;
  const frame = current || await renderPanoView(panoramaView(panorama), size);
  return { blob: await canvasToBlob(frame.image), panoId, width: frame.width, height: frame.height };
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

async function renderPanoView(view: PanoramaView, size: { width: number; height: number }) {
  const dpr = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? window.devicePixelRatio : 1;
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  Object.assign(container.style, {
    position: 'fixed', top: '0', left: '0', zIndex: '-1', pointerEvents: 'none',
    width: `${Math.ceil(size.width / dpr)}px`,
    height: `${Math.ceil(size.height / dpr)}px`
  });
  const host = document.createElement('div');
  Object.assign(host.style, { width: '100%', height: '100%' });
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
    return await waitForStableFrame(offscreen, host, size);
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

function copyFrame(
  host: HTMLElement,
  size: { width: number; height: number }
): CapturedFrame | null {
  const sample = document.createElement('canvas');
  sample.width = 64;
  sample.height = 36;
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not inspect the Street View image');

  for (const canvas of sceneCanvases(host)) {
    if (canvas.width < size.width || canvas.height < size.height) continue;
    try {
      context.clearRect(0, 0, sample.width, sample.height);
      context.drawImage(canvas, 0, 0, sample.width, sample.height);
      if (frameFingerprint(context.getImageData(0, 0, sample.width, sample.height).data) !== null) {
        return { image: drawScaled(canvas, size.width, size.height), ...size };
      }
    } catch { /* OpenSV may clear or swap its WebGL buffer between frames */ }
  }
  return null;
}

function waitForStableFrame(
  panorama: google.maps.StreetViewPanorama,
  host: HTMLElement,
  size: { width: number; height: number }
) {
  return new Promise<CapturedFrame>((resolve, reject) => {
    let listener: google.maps.MapsEventListener | null = null;
    const timer = setTimeout(() => {
      listener?.remove();
      reject(new Error('Street View image is unavailable'));
    }, RENDER_TIMEOUT_MS);
    listener = panorama.addListener('iv_renderstable', () => {
      const frame = copyFrame(host, size);
      if (frame) {
        clearTimeout(timer);
        listener?.remove();
        resolve(frame);
      }
    });
  });
}

function sceneCanvas(host: HTMLElement) {
  return sceneCanvases(host)[0] || null;
}

function sceneCanvases(host: HTMLElement) {
  return [...host.querySelectorAll<HTMLCanvasElement>('canvas.widget-scene-canvas')]
    .filter((canvas) => canvas.width > 0 && canvas.height > 0)
    .sort((left, right) => right.width * right.height - left.width * left.height);
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
