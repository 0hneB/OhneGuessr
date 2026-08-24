const WIKIPEDIA_RESULTS = 20;
const FETCH_TIMEOUT_MS = 15_000;
const SEARCH_RADIUS_METERS = 10_000;
const EARTH_RADIUS_METERS = 6_371_008.8;
const ICON = 'M12,2A10,10 0 1,0 12,22A10,10 0 0,0 12,2M15.9,7.1L13.4,13.4L7.1,15.9L9.6,9.6L15.9,7.1M12,10.9A1.1,1.1 0 1,0 12,13.1A1.1,1.1 0 0,0 12,10.9Z';
const cleanText = (value, maximum = 1_200) => (typeof value === 'string' ? value : '').replace(/\s+/gu, ' ').trim().slice(0, maximum);
const radians = (degrees) => degrees * Math.PI / 180;
const degrees = (value) => value * 180 / Math.PI;
export function wikipediaLanguage(value) {
    const language = cleanText(value, 20).toLowerCase().split(/[-_]/u)[0];
    return /^[a-z]{2,3}$/u.test(language) ? language : 'en';
}
export function wikipediaRequestURL(language, position) {
    if (!Number.isFinite(position?.lat) || !Number.isFinite(position?.lng)
        || Math.abs(position.lat) > 90 || Math.abs(position.lng) > 180) {
        throw new Error('The panorama has invalid coordinates.');
    }
    const url = new URL(`https://${wikipediaLanguage(language)}.wikipedia.org/w/api.php`);
    const params = {
        action: 'query',
        generator: 'geosearch',
        ggscoord: `${position.lat}|${position.lng}`,
        ggsradius: String(SEARCH_RADIUS_METERS),
        ggslimit: String(WIKIPEDIA_RESULTS),
        ggsnamespace: '0',
        prop: 'coordinates|pageimages|extracts|pageprops',
        piprop: 'thumbnail',
        pithumbsize: '640',
        pilimit: 'max',
        exintro: '1',
        explaintext: '1',
        exsentences: '3',
        exlimit: 'max',
        ppprop: 'disambiguation',
        redirects: '1',
        format: 'json',
        formatversion: '2',
        origin: '*'
    };
    for (const [key, value] of Object.entries(params))
        url.searchParams.set(key, value);
    return url.href;
}
function safeThumbnail(value) {
    try {
        const url = new URL(cleanText(value, 2_000));
        return url.protocol === 'https:' && url.hostname === 'upload.wikimedia.org' ? url.href : '';
    }
    catch {
        return '';
    }
}
export function parseWikipediaResponse(value, language) {
    const source = value && typeof value === 'object' ? value : {};
    const query = source.query && typeof source.query === 'object'
        ? source.query : {};
    const rawPages = Array.isArray(query.pages)
        ? query.pages
        : query.pages && typeof query.pages === 'object'
            ? Object.values(query.pages)
            : [];
    const lang = wikipediaLanguage(language);
    const places = [];
    const seen = new Set();
    for (const rawPage of rawPages.slice(0, WIKIPEDIA_RESULTS)) {
        if (!rawPage || typeof rawPage !== 'object')
            continue;
        const page = rawPage;
        const id = Number(page.pageid);
        const title = cleanText(page.title, 160);
        const pageProps = page.pageprops && typeof page.pageprops === 'object'
            ? page.pageprops : {};
        const coordinates = Array.isArray(page.coordinates) ? page.coordinates : [];
        const coordinate = coordinates.find((item) => item && typeof item === 'object' && item.primary !== undefined)
            || coordinates[0];
        const point = coordinate && typeof coordinate === 'object'
            ? coordinate : {};
        const lat = Number(point.lat);
        const lng = Number(point.lon);
        if (!Number.isInteger(id) || id <= 0 || seen.has(id) || !title
            || 'disambiguation' in pageProps || !Number.isFinite(lat) || !Number.isFinite(lng)
            || Math.abs(lat) > 90 || Math.abs(lng) > 180)
            continue;
        seen.add(id);
        const thumbnail = page.thumbnail && typeof page.thumbnail === 'object'
            ? safeThumbnail(page.thumbnail.source) : '';
        places.push({
            id,
            title,
            position: { lat, lng },
            thumbnail,
            extract: cleanText(page.extract),
            url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`,
            language: lang
        });
    }
    return places;
}
export function geoVector(from, to) {
    const lat1 = radians(from.lat);
    const lat2 = radians(to.lat);
    const deltaLat = lat2 - lat1;
    const deltaLng = radians(((to.lng - from.lng + 540) % 360) - 180);
    const a = Math.sin(deltaLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    const distance = EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    const y = Math.sin(deltaLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2)
        - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
    const bearing = (degrees(Math.atan2(y, x)) + 360) % 360;
    return { distance, bearing };
}
export function formatDistance(meters) {
    if (!Number.isFinite(meters))
        return '—';
    if (meters < 1_000)
        return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
    const kilometers = meters / 1_000;
    return `${kilometers < 10 ? kilometers.toFixed(1) : Math.round(kilometers)} km`;
}
export function compassDirection(bearing) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(((bearing % 360) + 360) % 360 / 45) % directions.length];
}
export async function fetchNearbyPlaces(position, language, signal) {
    const requestedLanguage = wikipediaLanguage(language);
    const languages = requestedLanguage === 'en' ? ['en'] : [requestedLanguage, 'en'];
    let successfulRequest = false;
    let lastError = null;
    for (const lang of languages) {
        try {
            const response = await fetch(wikipediaRequestURL(lang, position), {
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                signal
            });
            if (response.status === 429)
                throw new Error('Wikipedia is rate limiting requests. Try again shortly.');
            if (!response.ok)
                throw new Error(`Wikipedia request failed (HTTP ${response.status}).`);
            let body;
            try {
                body = await response.json();
            }
            catch {
                throw new Error('Wikipedia returned an invalid response.');
            }
            const apiError = body && typeof body === 'object'
                ? body.error : null;
            if (apiError)
                throw new Error('Wikipedia rejected the nearby-place search.');
            successfulRequest = true;
            const places = parseWikipediaResponse(body, lang)
                .sort((left, right) => geoVector(position, left.position).distance - geoVector(position, right.position).distance);
            if (places.length)
                return places;
        }
        catch (error) {
            if (error?.name === 'AbortError')
                throw error;
            lastError = error instanceof Error ? error : new Error('Could not reach Wikipedia.');
        }
    }
    if (!successfulRequest && lastError)
        throw lastError;
    return [];
}
function element(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text)
        node.textContent = text;
    return node;
}
function imageFor(place, className) {
    if (!place.thumbnail)
        return null;
    const image = element('img', className);
    image.src = place.thumbnail;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => image.remove(), { once: true });
    return image;
}
function activate(api) {
    const style = document.createElement('style');
    style.textContent = `
    .nearby-explorer-root { display:grid; gap:12px; color:#e9edf2; font-family:system-ui,sans-serif }
    .nearby-explorer-retry { min-height:32px; padding:0 11px; color:#fff; background:#292e34;
      border:1px solid rgba(255,255,255,.13); border-radius:7px; font:700 12px/1 system-ui,sans-serif; cursor:pointer }
    .nearby-explorer-retry:hover { background:#343a42 }
    .nearby-explorer-status { padding:18px; color:#cbd2da; background:#22262b;
      border:1px solid rgba(255,255,255,.1); border-radius:9px; font-size:14px; text-align:center }
    .nearby-explorer-status.error { color:#ffb4b4 }
    .nearby-explorer-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px }
    .nearby-explorer-card { display:grid; min-width:0; overflow:hidden; padding:0; color:#edf1f6; background:#22262b;
      border:1px solid rgba(255,255,255,.1); border-radius:8px; cursor:pointer; text-align:left }
    .nearby-explorer-card:hover, .nearby-explorer-card:focus-visible { border-color:rgba(var(--accent-rgb),.75); outline:none }
    .nearby-explorer-card img { width:100%; height:100px; object-fit:cover; background:#15171a }
    .nearby-explorer-card-copy { min-width:0; padding:8px 9px }
    .nearby-explorer-card-title { display:-webkit-box; overflow:hidden; color:#fff; font-size:13px; font-weight:750;
      line-height:1.3; -webkit-box-orient:vertical; -webkit-line-clamp:2 }
    .nearby-explorer-card-meta { display:block; margin-top:4px; color:#aeb7c2; font-size:11px }
    .nearby-explorer-place { overflow:hidden; background:#22262b; border:1px solid rgba(255,255,255,.1); border-radius:9px }
    .nearby-explorer-hero { display:block; width:100%; max-height:230px; object-fit:cover; background:#15171a }
    .nearby-explorer-place-copy { padding:13px }
    .nearby-explorer-place-meta { margin:0 0 4px; color:var(--accent); font-size:12px; font-weight:750; letter-spacing:.02em }
    .nearby-explorer-place h3 { margin:0; color:#fff; font-size:21px; line-height:1.22 }
    .nearby-explorer-extract { margin:10px 0 0; color:#d3d9e1; font-size:14px; line-height:1.5 }
    .nearby-explorer-actions { display:flex; flex-wrap:wrap; gap:7px }
    .nearby-explorer-actions button { min-height:36px; padding:0 13px; color:#fff; background:#292e34;
      border:1px solid rgba(255,255,255,.13); border-radius:7px; font:700 13px/1 system-ui,sans-serif; cursor:pointer }
    .nearby-explorer-actions button:hover { background:#343a42 }
    @media (max-width:520px) {
      .nearby-explorer-grid { grid-template-columns:1fr }
    }
  `;
    document.head.append(style);
    let places = [];
    let request = null;
    let windowOpen = false;
    let hudButton = null;
    const panel = api.ui.createWindow({
        title: 'Nearby Explorer',
        ariaLabel: 'Nearby Wikipedia places',
        closeLabel: 'Close Nearby Explorer',
        onClose() {
            windowOpen = false;
            request?.abort();
            hudButton?.setPressed(false);
        }
    });
    const currentView = () => api.panorama.getMetadata();
    const vectorFromCurrent = (place) => {
        const view = currentView();
        return view ? geoVector(view.position, place.position) : { distance: Number.NaN, bearing: 0 };
    };
    const vectorLabel = (vector) => `${formatDistance(vector.distance)} · ${compassDirection(vector.bearing)} ${Math.round(vector.bearing)}°`;
    const renderStatus = (message, error = false) => {
        const root = element('div', 'nearby-explorer-root');
        const status = element('div', `nearby-explorer-status${error ? ' error' : ''}`, message);
        status.setAttribute('role', error ? 'alert' : 'status');
        root.append(status);
        if (error) {
            const retry = element('button', 'nearby-explorer-retry', 'Try again');
            retry.type = 'button';
            retry.addEventListener('click', () => void loadNearby());
            root.append(retry);
        }
        panel.content.replaceChildren(root);
        panel.show();
    };
    const renderBrowse = () => {
        const root = element('div', 'nearby-explorer-root');
        const view = currentView();
        const ranked = [...places].sort((left, right) => view
            ? geoVector(view.position, left.position).distance - geoVector(view.position, right.position).distance
            : left.title.localeCompare(right.title));
        if (!ranked.length)
            root.append(element('div', 'nearby-explorer-status', 'No nearby places found.'));
        const grid = element('div', 'nearby-explorer-grid');
        for (const place of ranked) {
            const vector = view ? geoVector(view.position, place.position) : { distance: Number.NaN, bearing: 0 };
            const card = element('button', 'nearby-explorer-card');
            card.type = 'button';
            const image = imageFor(place, '');
            if (image)
                card.append(image);
            const copy = element('span', 'nearby-explorer-card-copy');
            copy.append(element('span', 'nearby-explorer-card-title', place.title), element('span', 'nearby-explorer-card-meta', vectorLabel(vector)));
            card.append(copy);
            card.addEventListener('click', () => showPlace(place));
            grid.append(card);
        }
        root.append(grid);
        panel.content.replaceChildren(root);
        panel.show();
    };
    const showPlace = (place) => {
        const root = element('div', 'nearby-explorer-root');
        const article = element('article', 'nearby-explorer-place');
        const image = imageFor(place, 'nearby-explorer-hero');
        if (image)
            article.append(image);
        const copy = element('div', 'nearby-explorer-place-copy');
        copy.append(element('p', 'nearby-explorer-place-meta', vectorLabel(vectorFromCurrent(place))), element('h3', '', place.title));
        copy.append(element('p', 'nearby-explorer-extract', place.extract || 'Wikipedia has no short summary for this place.'));
        article.append(copy);
        const actions = element('div', 'nearby-explorer-actions');
        const back = element('button', '', 'All nearby places');
        back.type = 'button';
        back.addEventListener('click', renderBrowse);
        const open = element('button', '', 'Open Wikipedia');
        open.type = 'button';
        open.addEventListener('click', () => void api.ui.openExternal(place.url));
        actions.append(back, open);
        root.append(article, actions);
        panel.content.replaceChildren(root);
        panel.show();
    };
    async function loadNearby(providedView = currentView()) {
        request?.abort();
        if (!providedView) {
            request = null;
            renderStatus('Waiting for a panorama…');
            return;
        }
        const controller = new AbortController();
        request = controller;
        renderStatus('Finding Wikipedia places within 10 km…');
        let timedOut = false;
        const timeout = window.setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, FETCH_TIMEOUT_MS);
        try {
            const next = await fetchNearbyPlaces(providedView.position, navigator.language, controller.signal);
            if (request !== controller || !windowOpen)
                return;
            places = next;
            renderBrowse();
        }
        catch (error) {
            if (request !== controller || !windowOpen)
                return;
            const aborted = error?.name === 'AbortError';
            if (aborted && !timedOut)
                return;
            renderStatus(timedOut
                ? 'Wikipedia timed out'
                : error instanceof Error ? error.message : 'Could not load nearby places', true);
        }
        finally {
            window.clearTimeout(timeout);
            if (request === controller)
                request = null;
        }
    }
    hudButton = api.hud.addButton({
        icon: ICON,
        label: 'Open Nearby Explorer',
        onClick() {
            windowOpen = true;
            hudButton?.setPressed(true);
            void loadNearby();
        }
    });
    const stopRoundListener = api.panorama.onRoundStart(() => {
        places = [];
        if (windowOpen)
            void loadNearby();
    });
    return () => {
        request?.abort();
        stopRoundListener();
        panel.remove();
        hudButton?.remove();
        style.remove();
    };
}
export default { activate };
