const API_ORIGIN = 'https://my-api.plantnet.org';
const SPECIES_ORIGIN = 'https://identify.plantnet.org/k-world-flora/species/';
const SETTINGS_ERROR = 'Plant identification failed. Check the plugin settings and try again.';

type HudButton = ReturnType<OhneGuessrPluginAPI['hud']['addButton']>;

interface PlantResult {
  commonName: string;
  scientificName: string;
  family: string;
  score: number;
  url: string;
}

interface Identification {
  results: PlantResult[];
  remaining: number | null;
}

function accessError(origin: string) {
  const domains = origin === 'http://wails.localhost'
    ? [origin] : [origin, 'http://wails.localhost'];
  return `PlantNet access denied. Check the key, enable "Expose my API key", and add these authorized domains:
${domains.join('\n')}`;
}

export function parseAPIKey(value: unknown) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || /\s/.test(key)) throw new Error(SETTINGS_ERROR);
  return key;
}

export function parseIdentification(value: unknown): Identification {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawResults = Array.isArray(source.results) ? source.results : [];
  const results = rawResults.slice(0, 5).flatMap((result): PlantResult[] => {
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
      ? species.commonNames.find((name: unknown) => typeof name === 'string' && name.trim())?.trim() || ''
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

function endpoint(path: string, apiKey: string) {
  const url = new URL(path, API_ORIGIN);
  url.searchParams.set('api-key', apiKey);
  return url;
}

async function responseJSON(response: Response, origin: string): Promise<Record<string, unknown>> {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error(accessError(origin));
    if (response.status === 429) throw new Error('PlantNet API quota reached');
    throw new Error('Plant identification failed. Please try again.');
  }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new Error('PlantNet returned an invalid response'); }
  if (!data || typeof data !== 'object') {
    throw new Error('PlantNet returned an invalid response');
  }
  return data as Record<string, unknown>;
}

export async function identifyPlants(
  apiKey: string,
  image: Blob,
  signal?: AbortSignal,
  origin = globalThis.location?.origin || ''
) {
  const url = endpoint('/v2/identify/all', apiKey);
  url.searchParams.set('lang', 'en');
  url.searchParams.set('nb-results', '5');
  const form = new FormData();
  form.append('images', image, 'street-view.png');
  const response = await fetch(url, {
    method: 'POST',
    body: form,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal
  });
  return parseIdentification(await responseJSON(response, origin));
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text = '') {
  const node = document.createElement(tag);
  node.className = className!;
  node.textContent = text;
  return node;
}

function activate(api: OhneGuessrPluginAPI) {
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

  let request: AbortController | null = null;
  let previewURL = '';
  let hudButton: HudButton | null = null;

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
  const renderStatus = (message: string, error = false) => {
    const wrapper = element('div', `plantnet-status${error ? ' error' : ''}`);
    const body = element('div', '');
    if (!error) body.appendChild(element('div', 'plantnet-spinner'));
    body.appendChild(element('div', '', message));
    wrapper.appendChild(body);
    content.replaceChildren(...[preview(), wrapper].filter(Boolean) as Node[]);
  };
  const renderResults = ({ results }: Identification) => {
    const nodes: Node[] = [];
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
      const result = await identifyPlants(apiKey, capture.blob, controller.signal);
      if (!controller.signal.aborted) renderResults(result);
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name !== 'AbortError') {
        renderStatus(error instanceof Error ? error.message : 'Plant identification failed.', true);
      }
    } finally {
      if (request === controller) request = null;
    }
  };

  hudButton = api.hud.addButton({
    label: 'Identify plant',
    onClick: identify
  });

  return () => {
    request?.abort();
    clearPreview();
    style.remove();
  };
}

export default { activate } satisfies OhneGuessrPlugin;
