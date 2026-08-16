const OCR_ENDPOINT = 'https://api.ocr.space/parse/image';
const TRANSLATE_ENDPOINT = 'https://api.mymemory.translated.net/get';
const TARGET_STORAGE = 'ohneguessr.translator.target-language';
const CAPTURE_SIZE = { width: 1600, height: 900 };
const MAX_IMAGE_BYTES = 950 * 1024;
const ICON = 'M12.87,15.07L10.33,12.56L10.36,12.53C12.1,10.59 13.34,8.36 14.07,6H17V4H10V2H8V4H1V6H12.17C11.5,7.92 10.44,9.75 9,11.35C8.07,10.32 7.3,9.19 6.69,8H4.69C5.42,9.63 6.42,11.17 7.67,12.56L2.58,17.58L4,19L9,14L12.11,17.11L12.87,15.07M18.5,10H16.5L12,22H14L15.12,19H19.87L21,22H23L18.5,10M15.88,17L17.5,12.67L19.12,17H15.88Z';

export const TARGET_LANGUAGES = [
  ['en', 'English'], ['de', 'German'], ['es', 'Spanish'], ['fr', 'French'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'],
  ['cs', 'Czech'], ['da', 'Danish'], ['sv', 'Swedish'], ['no', 'Norwegian'],
  ['fi', 'Finnish'], ['ro', 'Romanian'], ['hu', 'Hungarian'], ['el', 'Greek'],
  ['tr', 'Turkish'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['ar', 'Arabic'],
  ['he', 'Hebrew'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['id', 'Indonesian'],
  ['ms', 'Malay'], ['th', 'Thai'], ['vi', 'Vietnamese'], ['ja', 'Japanese'],
  ['ko', 'Korean'], ['zh-CN', 'Chinese (Simplified)'], ['zh-TW', 'Chinese (Traditional)']
];

const languageCodes = new Map(TARGET_LANGUAGES.map(([code]) => [code.toLowerCase(), code]));
const cleanText = (value) => typeof value === 'string' ? value.trim() : '';

export function parseAPIKey(value) {
  const key = cleanText(value);
  if (!key || /\s/.test(key)) {
    throw new Error('Add a valid OCR.space API key under Plugins → Additional.');
  }
  return key;
}

export function normalizeTargetLanguage(value) {
  const requested = cleanText(value).toLowerCase();
  return languageCodes.get(requested) || languageCodes.get(requested.split('-')[0]) || 'en';
}

function errorMessages(value) {
  return (Array.isArray(value) ? value : [value]).map(cleanText).filter(Boolean);
}

export function parseOCRResponse(value) {
  const source = value && typeof value === 'object' ? value : {};
  const results = Array.isArray(source.ParsedResults) ? source.ParsedResults : [];
  const detected = results
    .map((result) => cleanText(result?.ParsedText))
    .filter(Boolean)
    .join('\n\n');
  if (detected) return detected;

  const message = [
    ...errorMessages(source.ErrorMessage),
    ...results.flatMap((result) => errorMessages(result?.ErrorMessage))
  ][0];
  if (source.IsErroredOnProcessing || message || source.OCRExitCode && source.OCRExitCode !== 1) {
    throw new Error(message || 'OCR.space could not read this image.');
  }
  return '';
}

export function splitTranslationText(value, maximum = 500) {
  if (!Number.isInteger(maximum) || maximum < 4) throw new Error('Invalid translation chunk size');
  const encoder = new TextEncoder();
  const chunks = [];
  let current = '';
  const push = () => {
    const chunk = current.trim();
    if (chunk) chunks.push(chunk);
    current = '';
  };

  for (const token of cleanText(value).split(/(\s+)/u).filter(Boolean)) {
    if (encoder.encode(current + token).length <= maximum) {
      current += token;
      continue;
    }
    push();
    for (const character of token) {
      if (encoder.encode(current + character).length > maximum) push();
      current += character;
    }
  }
  push();
  return chunks;
}

export function parseTranslationResponse(value) {
  const source = value && typeof value === 'object' ? value : {};
  if (source.quotaFinished) throw new Error('The MyMemory daily translation quota has been reached.');
  const status = Number(source.responseStatus || 200);
  const translatedText = cleanText(source.responseData?.translatedText);
  if (status !== 200 || !translatedText) {
    throw new Error(cleanText(source.responseDetails) || 'Translation failed. Please try again.');
  }
  return {
    text: translatedText,
    detectedLanguage: cleanText(source.responseData?.detectedLanguage)
  };
}

export async function recognizeText(apiKey, image, signal) {
  const form = new FormData();
  form.append('file', image, 'street-view.jpg');
  form.append('language', 'auto');
  form.append('OCREngine', '2');
  form.append('scale', 'true');
  form.append('detectOrientation', 'true');
  form.append('isOverlayRequired', 'false');
  const response = await fetch(OCR_ENDPOINT, {
    method: 'POST',
    headers: { apikey: apiKey },
    body: form,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('OCR.space rejected the API key. Check the plugin settings.');
  }
  if (response.status === 429) throw new Error('The OCR.space request limit has been reached.');
  if (!response.ok) throw new Error('Text detection failed. Please try again.');
  let body;
  try { body = await response.json(); }
  catch { throw new Error('OCR.space returned an invalid response.'); }
  return parseOCRResponse(body);
}

function decodeEntities(value) {
  if (typeof document === 'undefined') return value;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

export async function translateText(value, target, signal) {
  const chunks = splitTranslationText(value);
  const translated = [];
  let detectedLanguage = '';
  for (const chunk of chunks) {
    const url = new URL(TRANSLATE_ENDPOINT);
    url.searchParams.set('q', chunk);
    url.searchParams.set('langpair', `Autodetect|${normalizeTargetLanguage(target)}`);
    const response = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal
    });
    if (response.status === 429) throw new Error('The MyMemory request limit has been reached.');
    if (!response.ok) throw new Error('Translation failed. Please try again.');
    let body;
    try { body = await response.json(); }
    catch { throw new Error('MyMemory returned an invalid response.'); }
    const result = parseTranslationResponse(body);
    translated.push(decodeEntities(result.text));
    detectedLanguage ||= result.detectedLanguage;
  }
  return { text: translated.join('\n'), detectedLanguage };
}

function jpeg(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('Could not prepare the captured image.')),
    'image/jpeg', quality
  ));
}

async function prepareImage(source) {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the captured image.');
    context.drawImage(bitmap, 0, 0);
    for (const quality of [0.82, 0.65, 0.5]) {
      const image = await jpeg(canvas, quality);
      if (image.size <= MAX_IMAGE_BYTES) return image;
    }
    throw new Error('The captured image is too large. Zoom closer to the text and try again.');
  } finally {
    bitmap.close?.();
  }
}

function element(tag, className = '', value = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value) node.textContent = value;
  return node;
}

function activate(api) {
  const style = document.createElement('style');
  style.textContent = `
    .translator { display:grid; gap:11px; color:#e8ebf0 }
    .translator-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px;
      padding:9px 10px; background:#202020; border:1px solid rgba(255,255,255,.09); border-radius:6px }
    .translator-target { width:100%; flex-direction:row; align-items:center; gap:9px; margin:0; color:#b8c0cb; font-size:13px }
    .translator-select { flex:1; width:auto; min-width:0 }
    .translator-target select { min-width:0; color:var(--launcher-text,#fff); background:var(--launcher-element,#222);
      border:1px solid var(--launcher-control-border,rgba(255,255,255,.09)) }
    .translator-target select:focus { border-color:var(--accent) }
    .translator-status { display:flex; min-height:54px; align-items:center; justify-content:center; gap:9px;
      padding:12px; color:#c6cdd7; background:#202020; border:1px solid rgba(255,255,255,.09);
      border-radius:6px; text-align:center }
    .translator-status[hidden], .translator-results[hidden] { display:none }
    .translator-status.error, .translator-text.error { color:#fca5a5 }
    .translator-spinner { width:15px; height:15px; flex:none; border:2px solid rgba(255,255,255,.18);
      border-top-color:var(--accent); border-radius:50%; animation:translator-spin .8s linear infinite }
    .translator-results { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px }
    .translator-card { min-width:0; overflow:hidden; background:#202020;
      border:1px solid rgba(255,255,255,.09); border-radius:6px }
    .translator-card h3 { margin:0; padding:8px 10px; color:#fff; border-bottom:1px solid rgba(255,255,255,.09);
      font-size:13px; letter-spacing:.03em }
    .translator-text { min-height:118px; max-height:320px; margin:0; padding:11px; overflow:auto;
      color:#edf0f5; font:14px/1.5 system-ui,sans-serif; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text }
    @media (max-width:620px) { .translator-results { grid-template-columns:1fr } }
    @keyframes translator-spin { to { transform:rotate(360deg) } }
  `;
  document.head.append(style);

  let request = null;
  let sequence = 0;
  let originalText = '';
  let button = null;

  const targetSelect = element('select');
  for (const [code, label] of TARGET_LANGUAGES) {
    const option = element('option', '', label);
    option.value = code;
    targetSelect.append(option);
  }
  let savedTarget = '';
  try { savedTarget = localStorage.getItem(TARGET_STORAGE) || ''; } catch {}
  targetSelect.value = normalizeTargetLanguage(savedTarget || navigator.language);

  const targetSelectWrap = element('span', 'setting-select translator-select');
  const targetChevron = element('span', 'svg-icon chevron-icon');
  targetChevron.setAttribute('aria-hidden', 'true');
  targetSelectWrap.append(targetSelect, targetChevron);
  const targetLabel = element('label', 'setting translator-target');
  targetLabel.append(element('span', '', 'Translate to'), targetSelectWrap);
  const toolbar = element('div', 'translator-toolbar');
  toolbar.append(targetLabel);
  const status = element('div', 'translator-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;

  const originalTitle = element('h3', '', 'Detected text');
  const originalBody = element('pre', 'translator-text');
  const originalCard = element('section', 'translator-card');
  originalCard.append(originalTitle, originalBody);
  const translationTitle = element('h3');
  const translationBody = element('pre', 'translator-text');
  const translationCard = element('section', 'translator-card');
  translationCard.append(translationTitle, translationBody);
  const results = element('div', 'translator-results');
  results.hidden = true;
  results.append(originalCard, translationCard);
  const root = element('div', 'translator');
  root.append(toolbar, status, results);

  const setTranslationTitle = () => {
    const language = TARGET_LANGUAGES.find(([code]) => code === targetSelect.value)?.[1] || 'Translation';
    translationTitle.textContent = `Translation · ${language}`;
  };
  setTranslationTitle();

  const setStatus = (message = '', kind = '') => {
    status.className = `translator-status${kind === 'error' ? ' error' : ''}`;
    status.replaceChildren();
    status.hidden = !message;
    if (kind === 'loading') status.append(element('span', 'translator-spinner'));
    if (message) status.append(document.createTextNode(message));
  };

  const cancel = () => {
    sequence += 1;
    request?.abort();
    request = null;
  };
  const begin = () => {
    request?.abort();
    request = new AbortController();
    return { controller: request, id: ++sequence };
  };
  const active = (id) => id === sequence;
  const finish = (controller, id) => {
    if (active(id) && request === controller) request = null;
  };

  const panel = api.ui.createWindow({
    title: 'Translator',
    ariaLabel: 'Translate visible text',
    closeLabel: 'Close Translator',
    onClose() {
      cancel();
      button?.setPressed(false);
    }
  });
  panel.content.replaceChildren(root);

  const renderTranslation = async (controller, id) => {
    setTranslationTitle();
    translationBody.classList.remove('error');
    translationBody.textContent = '';
    setStatus('Translating…', 'loading');
    try {
      const translation = await translateText(originalText, targetSelect.value, controller.signal);
      if (!active(id)) return;
      translationBody.textContent = translation.text;
      const detected = TARGET_LANGUAGES.find(([code]) =>
        code.toLowerCase() === translation.detectedLanguage.toLowerCase())?.[1];
      originalTitle.textContent = detected ? `Detected text: ${detected}` : 'Detected text';
      setStatus();
    } catch (error) {
      if (error?.name === 'AbortError' || !active(id)) return;
      translationBody.classList.add('error');
      translationBody.textContent = error instanceof Error ? error.message : 'Translation failed.';
      setStatus();
    }
  };

  const scan = async () => {
    const { controller, id } = begin();
    originalText = '';
    originalTitle.textContent = 'Detected text';
    results.hidden = true;
    panel.show();
    button?.setPressed(true);
    setStatus('Capturing the current view…', 'loading');
    try {
      const apiKey = parseAPIKey(await api.settings.get('apiKey'));
      const capture = await api.panorama.captureViewport(CAPTURE_SIZE);
      if (!active(id)) return;
      const image = await prepareImage(capture.blob);
      setStatus('Reading visible text…', 'loading');
      originalText = await recognizeText(apiKey, image, controller.signal);
      if (!active(id)) return;
      if (!originalText) {
        setStatus('No readable text was found. Zoom closer and try again.');
        return;
      }
      originalBody.textContent = originalText;
      results.hidden = false;
      await renderTranslation(controller, id);
    } catch (error) {
      if (error?.name !== 'AbortError' && active(id)) {
        setStatus(error instanceof Error ? error.message : 'Text detection failed.', 'error');
      }
    } finally {
      finish(controller, id);
    }
  };

  targetSelect.addEventListener('change', () => {
    setTranslationTitle();
    try { localStorage.setItem(TARGET_STORAGE, targetSelect.value); } catch {}
    if (!originalText) return;
    const { controller, id } = begin();
    void renderTranslation(controller, id).finally(() => finish(controller, id));
  });

  button = api.hud.addButton({ icon: ICON, label: 'Translate visible text', onClick: scan });
  const stopRoundListener = api.panorama.onRoundStart(() => {
    cancel();
    originalText = '';
    results.hidden = true;
    setStatus();
    panel.hide();
    button?.setPressed(false);
  });

  return () => {
    cancel();
    stopRoundListener();
    button?.remove();
    panel.remove();
    style.remove();
  };
}

export default { activate };
