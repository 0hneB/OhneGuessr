const FLAG_ENDPOINT = 'https://flagcdn.com';
const ADDRESS_ORDER = [
    'house_number', 'house_name', 'road', 'pedestrian', 'footway', 'path',
    'neighbourhood', 'quarter', 'suburb', 'borough', 'city_district', 'district',
    'hamlet', 'village', 'town', 'city', 'municipality', 'county', 'state_district',
    'state', 'region', 'postcode', 'continent'
];
const ADDRESS_LABELS = {
    house_number: 'House number', house_name: 'House name', road: 'Road',
    pedestrian: 'Pedestrian street', footway: 'Footway', path: 'Path',
    neighbourhood: 'Neighbourhood', quarter: 'Quarter', suburb: 'Suburb',
    borough: 'Borough', city_district: 'City district', district: 'District',
    hamlet: 'Hamlet', village: 'Village', town: 'Town', city: 'City',
    municipality: 'Municipality', county: 'County', state_district: 'State district',
    state: 'State / region', region: 'Region', postcode: 'Postal code', continent: 'Continent'
};
const CAMERA_LABELS = {
    gen1: 'Gen 1', gen2: 'Gen 2', gen4: 'Gen 4', badcam: 'Bad cam', tripod: 'Tripod', trekker: 'Trekker'
};
const PANO_LABELS = {
    official: 'Official', 'user-uploaded': 'User-uploaded', unknown: 'Unknown'
};
const cleanText = (value) => typeof value === 'string' ? value.trim() : '';
function addressLabel(key) {
    if (/^ISO3166-2-lvl\d+$/.test(key)) {
        return `ISO 3166-2 (level ${key.slice(key.lastIndexOf('lvl') + 3)})`;
    }
    return ADDRESS_LABELS[key] || key.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
export function flagSources(countryCode) {
    const code = cleanText(countryCode).toLowerCase();
    if (!/^[a-z]{2}$/.test(code))
        return null;
    return { src: `${FLAG_ENDPOINT}/${code}.svg` };
}
export function streetViewURL(metadata) {
    const panoId = cleanText(metadata?.panoId);
    const lat = metadata?.position?.lat;
    const lng = metadata?.position?.lng;
    if (!panoId || !Number.isFinite(lat) || !Number.isFinite(lng))
        return '';
    const url = new URL('https://www.google.com/maps/@');
    url.searchParams.set('api', '1');
    url.searchParams.set('map_action', 'pano');
    url.searchParams.set('pano', panoId);
    url.searchParams.set('viewpoint', `${lat},${lng}`);
    return url.href;
}
export function locationComponents(value) {
    const address = value && typeof value === 'object' ? value : {};
    return Object.entries(address)
        .filter(([key]) => key !== 'country' && key !== 'country_code')
        .flatMap(([key, rawValue], index) => {
        const component = cleanText(rawValue);
        return component ? [{
                key,
                label: addressLabel(key),
                value: component,
                order: ADDRESS_ORDER.indexOf(key),
                index
            }] : [];
    })
        .sort((left, right) => {
        const leftOrder = left.order < 0 ? ADDRESS_ORDER.length : left.order;
        const rightOrder = right.order < 0 ? ADDRESS_ORDER.length : right.order;
        return leftOrder - rightOrder || left.index - right.index;
    })
        .map(({ key, label, value: component }) => ({ key, label, value: component }));
}
function element(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text)
        node.textContent = text;
    return node;
}
function detailList(rows) {
    const list = element('dl', 'coverage-info-grid');
    for (const [label, value, className = ''] of rows) {
        list.append(element('dt', '', label));
        const body = element('dd', className);
        if (value instanceof Node)
            body.append(value);
        else
            body.textContent = value || '—';
        list.append(body);
    }
    return list;
}
function section(title, ...children) {
    const body = element('section', 'coverage-info-section');
    body.append(element('h3', '', title), ...children);
    return body;
}
const number = (value, digits = 1) => typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(digits) : '';
const meters = (value) => {
    const formatted = number(value);
    return formatted ? `${formatted} m` : '';
};
const degrees = (value) => {
    const formatted = number(value);
    return formatted ? `${formatted}°` : '';
};
function countryNode(location) {
    const country = element('span', 'coverage-info-country');
    const flag = flagSources(location.countryCode);
    if (flag) {
        const image = element('img', 'coverage-info-flag');
        image.width = 20;
        image.alt = '';
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => image.remove(), { once: true });
        image.src = flag.src;
        country.append(image);
    }
    country.append(document.createTextNode(location.country || '—'));
    return country;
}
function render(api, content, metadata, location, locationState = {}) {
    const root = element('div', 'coverage-info');
    const locationChildren = [];
    if (location) {
        if (location.fullAddress) {
            locationChildren.push(element('p', 'coverage-info-address', location.fullAddress));
        }
        const rows = [];
        if (location.country)
            rows.push(['Country', countryNode(location)]);
        if (location.feature)
            rows.push(['Place', location.feature]);
        const featureType = [location.category, location.type].filter(Boolean).join(' · ');
        if (featureType)
            rows.push(['Place type', featureType]);
        for (const component of locationComponents(location.address)) {
            rows.push([component.label, component.value]);
        }
        if (rows.length)
            locationChildren.push(detailList(rows));
    }
    else {
        const status = element('div', `coverage-info-status${locationState.error ? ' error' : ''}`);
        if (locationState.loading)
            status.append(element('span', 'coverage-info-spinner'));
        status.append(document.createTextNode(locationState.error || 'Loading full address…'));
        locationChildren.push(status);
    }
    root.append(section('Location', ...locationChildren));
    const panoramaLink = element('a', 'coverage-info-street-view-link', 'Open panorama in Google Street View');
    panoramaLink.href = streetViewURL(metadata);
    panoramaLink.target = '_blank';
    panoramaLink.rel = 'noopener noreferrer';
    panoramaLink.addEventListener('click', (event) => {
        event.preventDefault();
        void api.ui.openExternal(panoramaLink.href);
    });
    root.append(section('Street View coverage', panoramaLink, detailList([
        ['Imagery date', metadata.imageDate],
        ['Historical coverage', metadata.coverageDates?.join(', ')],
        ['Camera type', CAMERA_LABELS[metadata.cameraType] || ''],
        ['Panorama type', PANO_LABELS[metadata.panoType] || ''],
        ['Panorama ID', metadata.panoId, 'coverage-info-code'],
        ['Coordinates', `${number(metadata.position.lat, 7)}, ${number(metadata.position.lng, 7)}`, 'coverage-info-code'],
        ['Elevation', meters(metadata.elevation)],
        ['Uploader', metadata.uploader],
        ['Driving direction', degrees(metadata.drivingDirection)],
        ['Attribution', metadata.copyright],
        ['Long description', metadata.description],
        ['Short description', metadata.shortDescription],
        ['Photographer heading', degrees(metadata.photographer.heading)],
        ['Photographer pitch', degrees(metadata.photographer.pitch)]
    ])));
    root.append(section('Current view', detailList([
        ['Heading', degrees(metadata.heading)],
        ['Pitch', degrees(metadata.pitch)],
        ['Zoom', number(metadata.zoom, 2)]
    ])));
    content.replaceChildren(root);
}
function activate(api) {
    const style = document.createElement('style');
    style.textContent = `
    .coverage-info { display:grid; gap:10px; color:#e8ebf0 }
    .coverage-info-section { overflow:hidden; background:#202020; border:1px solid rgba(255,255,255,.09); border-radius:6px }
    .coverage-info-section h3 { margin:0; padding:8px 10px; color:#fff; border-bottom:1px solid rgba(255,255,255,.09); font-size:13px; letter-spacing:.04em; text-transform:uppercase }
    .coverage-info-street-view-link { display:block; padding:8px 10px; color:#8fc7ef; border-bottom:1px solid rgba(255,255,255,.09); font-size:13px; text-decoration:none }
    .coverage-info-street-view-link:hover, .coverage-info-street-view-link:focus-visible { text-decoration:underline }
    .coverage-info-address { margin:0; padding:10px; color:#fff; font-size:14px; line-height:1.45 }
    .coverage-info-grid { display:grid; grid-template-columns:minmax(94px,.65fr) minmax(0,1.35fr); margin:0 }
    .coverage-info-grid dt, .coverage-info-grid dd { margin:0; padding:6px 10px; border-top:1px solid rgba(255,255,255,.065); overflow-wrap:anywhere }
    .coverage-info-grid dt { color:#9fa8b5; font-size:12px }
    .coverage-info-grid dd { color:#edf0f5; font-size:13px }
    .coverage-info-grid dt:first-child, .coverage-info-grid dt:first-child + dd { border-top:0 }
    .coverage-info-code { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px !important; font-variant-numeric:tabular-nums }
    .coverage-info-country { display:inline-flex; align-items:center; gap:7px }
    .coverage-info-flag { display:block; flex:none; width:20px; max-height:15px; border-radius:0; object-fit:contain }
    .coverage-info-status { display:flex; min-height:62px; align-items:center; justify-content:center; gap:9px; padding:12px; color:#aeb6c2; font-size:13px; text-align:center }
    .coverage-info-status.error { color:#fca5a5 }
    .coverage-info-spinner { width:14px; height:14px; flex:none; border:2px solid rgba(255,255,255,.18); border-top-color:#8fc7ef; border-radius:50%; animation:coverage-info-spin .8s linear infinite }
    @keyframes coverage-info-spin { to { transform:rotate(360deg) } }
  `;
    document.head.append(style);
    let request = null;
    let hudButton = null;
    let open = false;
    const panel = api.ui.createWindow({
        title: 'Coverage Info',
        ariaLabel: 'Street View coverage information',
        closeLabel: 'Close Coverage Info',
        onClose() {
            open = false;
            request?.abort();
            hudButton?.setPressed(false);
        }
    });
    const showInfo = async () => {
        open = true;
        request?.abort();
        const controller = new AbortController();
        request = controller;
        panel.show();
        hudButton?.setPressed(true);
        const metadata = api.panorama.getMetadata();
        if (!metadata) {
            const status = element('div', 'coverage-info-status error', 'No active panorama is available.');
            panel.content.replaceChildren(status);
            request = null;
            return;
        }
        render(api, panel.content, metadata, null, { loading: true });
        try {
            const [detailsResult, locationResult] = await Promise.allSettled([
                api.panorama.getDetails(),
                api.location.reverse(metadata.position)
            ]);
            if (controller.signal.aborted)
                return;
            const details = detailsResult.status === 'fulfilled' && detailsResult.value?.panoId === metadata.panoId
                ? detailsResult.value : null;
            const enrichedMetadata = details ? { ...metadata, ...details } : metadata;
            if (locationResult.status === 'fulfilled') {
                render(api, panel.content, enrichedMetadata, locationResult.value);
            }
            else {
                const error = locationResult.reason;
                render(api, panel.content, enrichedMetadata, null, {
                    error: error instanceof Error ? error.message : 'Could not load the full address.'
                });
            }
        }
        finally {
            if (request === controller)
                request = null;
        }
    };
    hudButton = api.hud.addButton({ label: 'Show coverage info', onClick: showInfo });
    api.panorama.onRoundStart(() => { if (open)
        void showInfo(); });
    return () => {
        request?.abort();
        style.remove();
    };
}
export default { activate };
