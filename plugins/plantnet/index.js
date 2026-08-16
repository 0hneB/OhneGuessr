const API_ORIGIN = 'https://my-api.plantnet.org';
const SPECIES_ORIGIN = 'https://identify.plantnet.org/k-world-flora/species/';
const ICON = 'M2,22V20C2,20 7,18 12,18C17,18 22,20 22,20V22H2M11.3,9.1C10.1,5.2 4,6.1 4,6.1C4,6.1 4.2,13.9 9.9,12.7C9.5,9.8 8,9 8,9C10.8,9 11,12.4 11,12.4V17C11.3,17 11.7,17 12,17C12.3,17 12.7,17 13,17V12.8C13,12.8 13,8.9 16,7.9C16,7.9 14,10.9 14,12.9C21,13.6 21,4 21,4C21,4 12.1,3 11.3,9.1Z';
const SETTINGS_ERROR = 'Plant identification failed. Check the plugin settings and try again.';

function accessError(origin) {
  const domains = origin === 'http://wails.localhost'
    ? [origin] : [origin, 'http://wails.localhost'];
  return `PlantNet access denied. Check the key, enable "Expose my API key", and add these authorized domains:
${domains.join('\n')}`;
}

export function parseAPIKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || /\s/.test(key)) throw new Error(SETTINGS_ERROR);
  return key;
}

export function parseIdentification(value) {
  const source = value && typeof value === 'object' ? value : {};
  const rawResults = Array.isArray(source.results) ? source.results : [];
  const results = rawResults.slice(0, 5).flatMap((result) => {
    if (!result || typeof result !== 'object' || !result.species || typeof result.species !== 'object') {
      return [];
    }
    const species = result.species;
    const scientificName = [species.scientificNameWithoutAuthor, species.scientificName]
      .find((name) => typeof name === 'string' && name.trim())?.trim();
    if (!scientificName) return [];
    const fullScientificName = [species.scientificName, scientificName]
      .find((name) => typeof name === 'string' && name.trim()).trim();
    const commonName = Array.isArray(species.commonNames)
      ? species.commonNames.find((name) => typeof name === 'string' && name.trim())?.trim() || ''
      : '';
    const family = species.family && typeof species.family === 'object'
      ? [species.family.scientificNameWithoutAuthor, species.family.scientificName]
        .find((name) => typeof name === 'string' && name.trim())?.trim() || ''
      : '';
    const score = typeof result.score === 'number' && Number.isFinite(result.score)
      ? Math.max(0, Math.min(1, result.score)) : 0;
    const url = `${SPECIES_ORIGIN}${encodeURIComponent(fullScientificName)}/data`;
    return [{ commonName, scientificName, family, score, url }];
  });
  const remaining = typeof source.remainingIdentificationRequests === 'number'
    && Number.isFinite(source.remainingIdentificationRequests)
    ? Math.max(0, Math.floor(source.remainingIdentificationRequests)) : null;
  return { results, remaining };
}

function endpoint(path, apiKey) {
  const url = new URL(path, API_ORIGIN);
  url.searchParams.set('api-key', apiKey);
  return url;
}

function responseJSON(response, origin) {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error(accessError(origin));
    if (response.status === 429) throw new Error('PlantNet API quota reached');
    throw new Error('Plant identification failed. Please try again.');
  }
  if (!response.data || typeof response.data !== 'object') {
    throw new Error('PlantNet returned an invalid response');
  }
  return response.data;
}

export async function identifyPlants(api, apiKey, image, signal) {
  const response = await api.network.request({
    url: endpoint('/v2/identify/all', apiKey).href,
    method: 'POST',
    query: { lang: 'en', 'nb-results': '5' },
    file: { field: 'images', blob: image, name: 'street-view.png' },
    response: 'json',
    signal
  });
  return parseIdentification(responseJSON(response, api.environment.origin));
}

function element(tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function activate(api) {
  const style = document.createElement('style');
  style.textContent = `
    .plantnet-preview { display:block; width:100%; height:auto; margin:0 0 12px;
      border-radius:5px; background:#101010 }
    .plantnet-status { display:grid; min-height:160px; place-items:center; color:#c8ced8;
      text-align:center; white-space:pre-line }
    .plantnet-status.error { color:#fca5a5 }
    .plantnet-spinner { width:26px; height:26px; margin:0 auto 10px; border:3px solid rgba(255,255,255,.18);
      border-top-color:#79c267; border-radius:50%; animation:plantnet-spin .8s linear infinite }
    .plantnet-results { display:grid; gap:9px; margin:0; padding:0; list-style:none }
    .plantnet-result { padding:10px 11px; background:#222; border:1px solid rgba(255,255,255,.1); border-radius:5px }
    .plantnet-result h3 { margin:0 0 2px; color:#fff; font-size:16px }
    .plantnet-result h3 a { color:inherit; text-decoration:none }
    .plantnet-result h3 a:hover { text-decoration:underline }
    .plantnet-scientific { color:#bec5cf; font-style:italic }
    .plantnet-meta { display:flex; flex-wrap:wrap; gap:5px 12px; margin-top:6px; color:#aeb6c2; font-size:12px }
    .plantnet-summary { margin:0 0 10px; color:#cdd3dc }
    @keyframes plantnet-spin { to { transform:rotate(360deg) } }
  `;
  document.head.appendChild(style);

  let request = null;
  let previewURL = '';
  let hudButton = null;

  const clearPreview = () => {
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = '';
  };
  const panel = api.ui.createWindow({
    title: 'PlantNet',
    ariaLabel: 'PlantNet identification',
    closeLabel: 'Close PlantNet',
    onClose() {
      request?.abort();
      hudButton?.setPressed(false);
      clearPreview();
    }
  });
  const content = panel.content;
  const preview = () => {
    if (!previewURL) return null;
    const image = element('img', 'plantnet-preview');
    image.src = previewURL;
    image.alt = 'Captured Street View sent to PlantNet';
    return image;
  };
  const renderStatus = (message, error = false) => {
    const wrapper = element('div', `plantnet-status${error ? ' error' : ''}`);
    const body = element('div', '');
    if (!error) body.appendChild(element('div', 'plantnet-spinner'));
    body.appendChild(element('div', '', message));
    wrapper.appendChild(body);
    content.replaceChildren(...[preview(), wrapper].filter(Boolean));
  };
  const renderResults = ({ results }) => {
    const nodes = [];
    const image = preview();
    if (image) nodes.push(image);
    if (!results.length) {
      nodes.push(element('p', 'plantnet-summary', 'PlantNet could not identify a plant in this view.'));
    }
    if (results.length) {
      const list = element('ol', 'plantnet-results');
      for (const result of results) {
        const item = element('li', 'plantnet-result');
        const heading = element('h3');
        const link = element('a', '', result.commonName || result.scientificName);
        link.href = result.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.addEventListener('click', (event) => {
          event.preventDefault();
          void api.ui.openExternal(result.url);
        });
        heading.appendChild(link);
        item.appendChild(heading);
        if (result.commonName && result.commonName.toLocaleLowerCase() !== result.scientificName.toLocaleLowerCase()) {
          item.appendChild(element('div', 'plantnet-scientific', result.scientificName));
        }
        const meta = element('div', 'plantnet-meta');
        if (result.family) meta.appendChild(element('span', '', `Family: ${result.family}`));
        meta.appendChild(element('span', '', `Match: ${Math.round(result.score * 1000) / 10}%`));
        item.appendChild(meta);
        list.appendChild(item);
      }
      nodes.push(list);
    }
    content.replaceChildren(...nodes);
  };
  const identify = async () => {
    if (request) return;
    panel.show();
    hudButton?.setPressed(true);
    clearPreview();
    renderStatus('Capturing the current view…');
    const controller = new AbortController();
    request = controller;
    try {
      const apiKey = parseAPIKey(await api.settings.get('apiKey'));
      const capture = await api.panorama.captureViewport();
      if (controller.signal.aborted) return;
      previewURL = URL.createObjectURL(capture.blob);
      renderStatus('Asking Pl@ntNet…');
      const result = await identifyPlants(api, apiKey, capture.blob, controller.signal);
      if (!controller.signal.aborted) renderResults(result);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        renderStatus(error instanceof Error ? error.message : 'Plant identification failed.', true);
      }
    } finally {
      if (request === controller) request = null;
    }
  };

  hudButton = api.hud.addButton({
    icon: ICON,
    label: 'Identify plant',
    onClick: identify
  });

  return () => {
    request?.abort();
    clearPreview();
    style.remove();
  };
}

globalThis.OhneGuessr?.registerPlugin({ activate });
