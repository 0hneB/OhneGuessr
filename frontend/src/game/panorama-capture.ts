const CANVAS_TIMEOUT_MS = 2_000;

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
  const requestedSize = options ? requestedCaptureSize(options) : null;
  const frame = await captureLiveFrame(panorama, host, viewportWidth, viewportHeight, requestedSize);
  return { blob: await canvasToBlob(frame.image), panoId, width: frame.width, height: frame.height };
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

async function captureLiveFrame(
  panorama: google.maps.StreetViewPanorama,
  host: HTMLElement,
  viewportWidth: number,
  viewportHeight: number,
  requestedSize: { width: number; height: number } | null
) {
  const sample = document.createElement('canvas');
  sample.width = 64;
  sample.height = 36;
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not inspect the Street View image');

  const copyFrame = () => {
    const canvases = [...host.querySelectorAll<HTMLCanvasElement>('canvas')]
      .filter((canvas) => canvas.width > 0 && canvas.height > 0)
      .sort((left, right) => right.width * right.height - left.width * left.height);
    for (const canvas of canvases) {
      try {
        context.clearRect(0, 0, sample.width, sample.height);
        context.drawImage(canvas, 0, 0, sample.width, sample.height);
        if (frameFingerprint(context.getImageData(0, 0, sample.width, sample.height).data) !== null) {
          const size = requestedSize || fitCaptureSize(
            viewportWidth, viewportHeight,
            Math.min(1920, canvas.width), Math.min(1080, canvas.height)
          );
          // OpenSV does not preserve its WebGL drawing buffer, so copy it before yielding.
          return { image: drawScaled(canvas, size.width, size.height), ...size };
        }
      } catch { /* try another rendered canvas */ }
    }
    return null;
  };

  const current = copyFrame();
  if (current) return current;

  return new Promise<NonNullable<ReturnType<typeof copyFrame>>>((resolve, reject) => {
    let listener: google.maps.MapsEventListener;
    const timer = setTimeout(() => {
      listener.remove();
      reject(new Error('Street View image is unavailable'));
    }, CANVAS_TIMEOUT_MS);
    listener = panorama.addListener('iv_renderstable', () => {
      const frame = copyFrame();
      if (!frame) return;
      clearTimeout(timer);
      listener.remove();
      resolve(frame);
    });
    // OpenSV emits iv_renderstable after this same-POV redraw completes.
    panorama.setPov(panorama.getPov());
  });
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
