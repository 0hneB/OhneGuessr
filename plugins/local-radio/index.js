const API_ENDPOINT = 'https://all.api.radio-browser.info/json/stations/search';
const VOLUME_STORAGE = 'ohneguessr.local-radio.volume';
const SEARCH_RADII = [100_000, 300_000];
const CANDIDATE_LIMIT = 5;
const STREAM_TIMEOUT = 8_000;
const ICON = 'M20,6A2,2 0 0,1 22,8V20A2,2 0 0,1 20,22H4A2,2 0 0,1 2,20V8C2,7.15 2.53,6.42 3.28,6.13L15.71,1L16.47,2.83L8.83,6H20M20,8H4V12H16V10H18V12H20V8M7,14A3,3 0 0,0 4,17A3,3 0 0,0 7,20A3,3 0 0,0 10,17A3,3 0 0,0 7,14Z';
const PLAY_ICON = 'M19 3H5C3.89 3 3 3.89 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.89 20.1 3 19 3M10 16V8L15 12';
const STOP_ICON = 'M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M9,9H15V15H9';
const cleanText = (value) => typeof value === 'string' ? value.trim() : '';
const errorName = (error) => cleanText(error?.name);
function safeURL(value, httpsOnly = false) {
    try {
        const url = new URL(cleanText(value));
        return (url.protocol === 'https:' || !httpsOnly && url.protocol === 'http:') ? url.href : '';
    }
    catch {
        return '';
    }
}
function rankStations(value, limit) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    const stations = [];
    for (const item of value) {
        if (!item || typeof item !== 'object')
            continue;
        const source = item;
        const uuid = cleanText(source.stationuuid);
        const name = cleanText(source.name);
        const streamURL = safeURL(source.url_resolved, true);
        const distance = typeof source.geo_distance === 'number' ? source.geo_distance : Number.NaN;
        if (!uuid || seen.has(uuid) || !name || !streamURL || !Number.isFinite(distance) || distance < 0
            || Number(source.hls) !== 0 || Number(source.lastcheckok) !== 1)
            continue;
        seen.add(uuid);
        stations.push({
            uuid,
            name,
            streamURL,
            homepage: safeURL(source.homepage),
            country: cleanText(source.country),
            state: cleanText(source.state),
            distance
        });
    }
    return stations.sort((left, right) => left.distance - right.distance).slice(0, limit);
}
async function requestStations(position, radius, limit, signal) {
    const url = new URL(API_ENDPOINT);
    url.searchParams.set('geo_lat', String(position.lat));
    url.searchParams.set('geo_long', String(position.lng));
    url.searchParams.set('geo_distance', String(radius));
    url.searchParams.set('hidebroken', 'true');
    url.searchParams.set('is_https', 'true');
    url.searchParams.set('limit', '1000');
    const response = await fetch(url, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal
    });
    if (!response.ok)
        throw new Error('The radio directory is unavailable.');
    let body;
    try {
        body = await response.json();
    }
    catch {
        throw new Error('The radio directory returned an invalid response.');
    }
    return rankStations(body, limit);
}
export async function findNearestStation(position, tryStation, signal, failed = new Set()) {
    for (const radius of SEARCH_RADII) {
        const stations = await requestStations(position, radius, CANDIDATE_LIMIT + failed.size, signal);
        const candidates = stations.filter(({ uuid }) => !failed.has(uuid)).slice(0, CANDIDATE_LIMIT);
        for (const station of candidates) {
            try {
                await tryStation(station, signal);
                return station;
            }
            catch (error) {
                if (errorName(error) === 'AbortError' || errorName(error) === 'NotAllowedError')
                    throw error;
                failed.add(station.uuid);
            }
        }
    }
    throw new Error('No playable local station was found within 300 km.');
}
function element(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text)
        node.textContent = text;
    return node;
}
function storedVolume() {
    try {
        const saved = localStorage.getItem(VOLUME_STORAGE);
        const value = saved === null || !saved.trim() ? Number.NaN : Number(saved);
        if (Number.isFinite(value) && value >= 0 && value <= 1)
            return value;
    }
    catch { }
    return 0.35;
}
function activate(api) {
    const style = document.createElement('style');
    style.textContent = `
    .local-radio { --launcher-control-text:#cbd2dd; --launcher-range-track:rgba(255,255,255,.16);
      display:grid; gap:12px; color:#e8ebf0 }
    .local-radio-status { display:grid; height:132px; place-items:center; padding:14px; overflow:auto;
      color:#d5dae2; background:#202020; border:1px solid rgba(255,255,255,.09);
      border-radius:6px; text-align:center }
    .local-radio-status.loading::before { width:18px; height:18px; margin-bottom:7px;
      border:2px solid rgba(255,255,255,.18); border-top-color:var(--accent);
      border-radius:50%; animation:local-radio-spin .8s linear infinite; content:'' }
    .local-radio-status.error { color:#fca5a5 }
    .local-radio-status.revealed { place-items:start; align-content:center; gap:3px; text-align:left }
    .local-radio-status h3 { margin:0; color:#fff; font-size:17px }
    .local-radio-meta { margin:0; color:#b9c0ca; font-size:13px }
    .local-radio-player { display:grid; grid-template-columns:34px auto minmax(0,1fr);
      align-items:center; gap:10px }
    .local-radio-player .setting-range-control { min-width:0 }
    .local-radio-playback { display:grid; width:34px; height:34px; padding:0; place-items:center;
      color:var(--accent); background:transparent; border:0; cursor:pointer }
    .local-radio-playback svg { width:29px; height:29px; fill:currentColor }
    .local-radio-playback.playing { color:#f87171 }
    .local-radio-playback:hover, .local-radio-playback:focus-visible { filter:brightness(1.18); outline:0 }
    .local-radio-actions { display:flex; gap:8px }
    .local-radio-actions .local-radio-button { flex:1 }
    .local-radio-button { min-height:38px; padding:8px 12px; color:#eef1f6; background:#292929;
      border:1px solid rgba(255,255,255,.14); border-radius:6px; font:600 14px system-ui,sans-serif;
      cursor:pointer }
    .local-radio-button:hover:not(:disabled) { background:#333 }
    .local-radio-button:disabled { opacity:.45; cursor:default }
    .local-radio-button:focus-visible { outline:2px solid var(--accent); outline-offset:2px }
    .local-radio-button[hidden] { display:none }
    .local-radio-website { padding:0; color:var(--accent); background:none; border:0;
      font:600 13px system-ui,sans-serif; cursor:pointer }
    .local-radio-website:hover { text-decoration:underline }
    @keyframes local-radio-spin { to { transform:rotate(360deg) } }
  `;
    document.head.append(style);
    let active = false;
    let blocked = false;
    let current = null;
    let request = null;
    let sequence = 0;
    let revealed = false;
    let retryAvailable = false;
    let hudButton = null;
    const failed = new Set();
    const audio = element('audio');
    audio.preload = 'none';
    audio.volume = storedVolume();
    audio.hidden = true;
    const status = element('div', 'local-radio-status', 'Radio is stopped.');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const toggle = element('button', 'local-radio-playback');
    toggle.type = 'button';
    const toggleIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    toggleIcon.setAttribute('viewBox', '0 0 24 24');
    toggleIcon.setAttribute('aria-hidden', 'true');
    const togglePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    toggleIcon.append(togglePath);
    toggle.append(toggleIcon);
    const reveal = element('button', 'local-radio-button', 'Reveal station');
    reveal.type = 'button';
    reveal.disabled = true;
    const retry = element('button', 'local-radio-button', 'Retry');
    retry.type = 'button';
    retry.hidden = true;
    const actions = element('div', 'local-radio-actions');
    actions.append(reveal, retry);
    const volume = element('input');
    volume.id = 'local-radio-volume';
    volume.type = 'range';
    volume.min = '0';
    volume.max = '100';
    volume.step = '1';
    volume.value = String(Math.round(audio.volume * 100));
    volume.style.setProperty('--range-progress', `${volume.value}%`);
    const volumeOutput = element('output', '', `${volume.value}%`);
    volumeOutput.setAttribute('for', volume.id);
    const volumeLabel = element('label', '', 'Volume');
    volumeLabel.htmlFor = volume.id;
    const volumeControl = element('div', 'setting-range-control');
    volumeControl.append(volume, volumeOutput);
    const player = element('div', 'setting-range local-radio-player');
    player.append(toggle, volumeLabel, volumeControl);
    const stationName = element('h3');
    const stationMeta = element('p', 'local-radio-meta');
    const website = element('button', 'local-radio-website', 'Open station website');
    website.type = 'button';
    const root = element('div', 'local-radio');
    root.append(audio, status, player, actions);
    const panel = api.ui.createWindow({
        title: 'Local Radio',
        ariaLabel: 'Local radio player',
        closeLabel: 'Close Local Radio',
        onClose() {
            hudButton?.setPressed(false);
        }
    });
    panel.content.replaceChildren(root);
    const refreshControls = () => {
        const playing = active && !blocked;
        const label = playing ? 'Stop local radio' : 'Start local radio';
        togglePath.setAttribute('d', playing ? STOP_ICON : PLAY_ICON);
        toggle.classList.toggle('playing', playing);
        toggle.setAttribute('aria-label', label);
        toggle.title = label;
        reveal.disabled = !current || revealed;
        reveal.textContent = revealed ? 'Station revealed' : 'Reveal station';
        retry.hidden = !retryAvailable;
    };
    const setStatus = (message, kind = '', canRetry = false) => {
        status.replaceChildren(document.createTextNode(message));
        status.className = `local-radio-status${kind ? ` ${kind}` : ''}`;
        retryAvailable = canRetry;
        refreshControls();
    };
    refreshControls();
    const clearAudio = () => {
        current = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
    };
    const cancel = () => {
        sequence += 1;
        request?.abort();
        request = null;
    };
    const hideReveal = () => {
        revealed = false;
        refreshControls();
    };
    const tryStation = (station, signal) => {
        if (signal.aborted)
            return Promise.reject(new DOMException('Aborted', 'AbortError'));
        audio.src = station.streamURL;
        audio.load();
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = window.setTimeout(() => finish(new Error('The station took too long to start.')), STREAM_TIMEOUT);
            const cleanup = () => {
                window.clearTimeout(timer);
                audio.removeEventListener('playing', onPlaying);
                audio.removeEventListener('error', onError);
                signal.removeEventListener('abort', onAbort);
            };
            const finish = (error) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                if (error)
                    reject(error);
                else
                    resolve();
            };
            const onPlaying = () => finish();
            const onError = () => finish(new Error('The station could not be played.'));
            const onAbort = () => finish(new DOMException('Aborted', 'AbortError'));
            audio.addEventListener('playing', onPlaying, { once: true });
            audio.addEventListener('error', onError, { once: true });
            signal.addEventListener('abort', onAbort, { once: true });
            try {
                void audio.play().catch(finish);
            }
            catch (error) {
                finish(error);
            }
        });
    };
    const tune = async (resetFailures = false) => {
        cancel();
        clearAudio();
        hideReveal();
        if (resetFailures)
            failed.clear();
        const metadata = api.panorama.getMetadata();
        if (!metadata || !Number.isFinite(metadata.position.lat) || !Number.isFinite(metadata.position.lng)) {
            setStatus('No panorama location is available for this round.', 'error', true);
            return;
        }
        const controller = new AbortController();
        const id = ++sequence;
        request = controller;
        setStatus('Finding a local station…', 'loading');
        try {
            const station = await findNearestStation(metadata.position, tryStation, controller.signal, failed);
            if (id !== sequence || !active)
                return;
            current = station;
            blocked = false;
            setStatus('Local radio playing.');
        }
        catch (error) {
            if (errorName(error) === 'AbortError' || id !== sequence || !active)
                return;
            if (errorName(error) === 'NotAllowedError') {
                blocked = true;
                setStatus('Press Start to resume playback.');
            }
            else {
                setStatus(error instanceof Error ? error.message : 'Local radio could not start.', 'error', true);
            }
        }
        finally {
            if (request === controller)
                request = null;
        }
    };
    const start = () => {
        active = true;
        blocked = false;
        void tune(true);
        refreshControls();
    };
    const stop = () => {
        active = false;
        blocked = false;
        failed.clear();
        cancel();
        clearAudio();
        hideReveal();
        setStatus('Radio is stopped.');
    };
    toggle.addEventListener('click', () => {
        if (active && !blocked)
            stop();
        else
            start();
    });
    retry.addEventListener('click', () => void tune(true));
    reveal.addEventListener('click', () => {
        if (!current)
            return;
        revealed = true;
        stationName.textContent = current.name;
        const area = [...new Set([current.state, current.country].filter(Boolean))].join(', ');
        const distance = current.distance < 1000
            ? `${Math.round(current.distance)} m away`
            : `${Math.round(current.distance / 1000)} km away`;
        stationMeta.textContent = [area, distance].filter(Boolean).join(' · ');
        website.hidden = !current.homepage;
        status.className = 'local-radio-status revealed';
        status.replaceChildren(stationName, stationMeta, ...(current.homepage ? [website] : []));
        refreshControls();
    });
    website.addEventListener('click', () => {
        if (current?.homepage)
            void api.ui.openExternal(current.homepage);
    });
    volume.addEventListener('input', () => {
        audio.volume = Number(volume.value) / 100;
        volume.style.setProperty('--range-progress', `${volume.value}%`);
        volumeOutput.value = `${volume.value}%`;
        volumeOutput.textContent = volumeOutput.value;
        try {
            localStorage.setItem(VOLUME_STORAGE, String(audio.volume));
        }
        catch { }
    });
    audio.addEventListener('error', () => {
        if (!active || !current)
            return;
        failed.add(current.uuid);
        void tune();
    });
    hudButton = api.hud.addButton({
        icon: ICON,
        label: 'Local radio',
        onClick() {
            panel.show();
            hudButton?.setPressed(true);
            if (!active)
                start();
        }
    });
    const removeRoundListener = api.panorama.onRoundStart(() => {
        failed.clear();
        hideReveal();
        if (!active)
            return;
        if (blocked) {
            clearAudio();
            setStatus('Press Start to resume playback.');
            return;
        }
        void tune();
    });
    return () => {
        active = false;
        cancel();
        clearAudio();
        removeRoundListener();
        hudButton?.remove();
        panel.remove();
        style.remove();
    };
}
export default { activate };
