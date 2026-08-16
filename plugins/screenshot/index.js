const ICON = 'M4,4H7L9,2H15L17,4H20A2,2 0 0,1 22,6V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4M12,7A5,5 0 0,0 7,12A5,5 0 0,0 12,17A5,5 0 0,0 17,12A5,5 0 0,0 12,7M12,9A3,3 0 0,1 15,12A3,3 0 0,1 12,15A3,3 0 0,1 9,12A3,3 0 0,1 12,9Z';
const CAPTURE_SIZE = { width: 1920, height: 1080 };

const text = (value) => typeof value === 'string' ? value.trim() : '';

export function administrativeArea(location) {
  const address = location?.address && typeof location.address === 'object' ? location.address : {};
  return [location?.state, location?.region, address.province, address.state_district, address.county]
    .map(text).find(Boolean) || '';
}

export function filenameSegment(value, fallback, maxLength = 64) {
  const segment = text(value).normalize('NFKC')
    .replace(/[\u0000-\u001F<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, maxLength)
    .replace(/[.\s-]+$/g, '');
  return segment || fallback;
}

function timestamp(date) {
  const part = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}` +
    `_${part(date.getHours())}-${part(date.getMinutes())}-${part(date.getSeconds())}`;
}

export function screenshotFilename(panoId, location, savedAt = new Date()) {
  const country = location?.country || location?.countryCode;
  return [
    filenameSegment(country, 'unknown-country', 48),
    filenameSegment(administrativeArea(location), 'unknown-region', 64),
    filenameSegment(panoId, 'unknown-pano', 80),
    timestamp(savedAt)
  ].join('-') + '.png';
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function activate(api) {
  const style = document.createElement('style');
  style.textContent = `
    .screenshot-error { margin:0; padding:16px; color:#fca5a5; text-align:center; line-height:1.45 }
  `;
  document.head.append(style);

  const panel = api.ui.createWindow({
    title: 'Screenshot',
    ariaLabel: 'Screenshot status',
    closeLabel: 'Close Screenshot'
  });
  let saving = false;
  let button = null;

  const showError = (message) => {
    const body = document.createElement('p');
    body.className = 'screenshot-error';
    body.textContent = message;
    panel.content.replaceChildren(body);
    panel.show();
  };

  const save = async () => {
    if (saving) return;
    saving = true;
    button?.setPressed(true);
    panel.hide();
    try {
      const metadata = api.panorama.getMetadata();
      if (!metadata) throw new Error('No active panorama to capture.');
      const location = api.location.reverse(metadata.position).catch(() => null);
      const capture = await api.panorama.captureViewport(CAPTURE_SIZE);
      download(capture.blob, screenshotFilename(capture.panoId, await location));
    } catch (error) {
      showError(error instanceof Error && error.message === 'No active panorama to capture.'
        ? error.message : 'Screenshot failed. Wait for Street View to load and try again.');
    } finally {
      saving = false;
      button?.setPressed(false);
    }
  };

  button = api.hud.addButton({ icon: ICON, label: 'Save screenshot', onClick: save });
  return () => style.remove();
}

globalThis.OhneGuessr?.registerPlugin({ activate });
