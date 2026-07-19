import { ApiError, getClue } from './api.js';
import { safeImageUrls, sanitizeHtml } from './sanitizer.js';

const LAYOUT_KEY = 'ohneguessr.learnableMeta.clue.layout';
const DEFAULT_WIDTH = 450;
const DEFAULT_HEIGHT = 550;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 220;
const EDGE = 12;
const IMAGE_LOAD_TIMEOUT_MS = 12_000;
const IMAGE_LENS_SIZE = 150;
const IMAGE_LENS_SCALE = 2;

const isLearnableMap = (map) => map?.source?.type === 'learnable-meta';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function iconControl(tag, iconClass, label) {
  const control = element(tag, 'icon-action lm-clue-action');
  if (tag === 'button') control.type = 'button';
  control.title = label;
  control.setAttribute('aria-label', label);
  const icon = element('span', `svg-icon ${iconClass}`);
  icon.setAttribute('aria-hidden', 'true');
  control.append(icon);
  return control;
}

export class LearnableMetaClues {
  constructor() {
    this.enabled = false;
    this.cache = new Map();
    this.requestToken = 0;
    this.viewKey = null;
    this.closedViewKey = null;
    this.drag = null;
    this.root = this._createWindow();
    document.body.appendChild(this.root);
    this._restoreLayout();
    this._bindLayout();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.hide({ resetClose: true });
  }

  hide({ resetClose = false } = {}) {
    this.requestToken += 1;
    this.root.classList.add('hidden');
    if (resetClose) {
      this.viewKey = null;
      this.closedViewKey = null;
    }
  }

  resetLayout() {
    try { localStorage.removeItem(LAYOUT_KEY); } catch { /* private mode */ }
    this._applyLayout(this._defaultLayout());
    this._persistLayout();
  }

  async show({ map, location, roundIndex, context }) {
    if (!this.enabled || !isLearnableMap(map)) {
      this.hide({ resetClose: true });
      return;
    }
    const mapId = map.source?.mapId;
    const panoId = location?.panoid || location?.panoId;
    const nextViewKey = `${context}:${mapId}:${roundIndex}:${panoId || ''}`;
    this.viewKey = nextViewKey;
    if (this.closedViewKey === nextViewKey) return;

    this.root.classList.remove('hidden');
    this._clampLayout();
    if (!mapId || !panoId) {
      this._renderMessage('No panorama ID is available for this clue.');
      return;
    }

    const token = ++this.requestToken;
    this._renderLoading();
    const cacheKey = `${mapId}:${panoId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (cached.missing) this._renderMessage('No Learnable Meta clue was found for this location.');
      else await this._renderClue(cached.data, token, nextViewKey);
      return;
    }

    try {
      const data = await getClue(mapId, panoId);
      if (token !== this.requestToken || this.viewKey !== nextViewKey) return;
      this.cache.set(cacheKey, { data });
      await this._renderClue(data, token, nextViewKey);
    } catch (error) {
      if (token !== this.requestToken || this.viewKey !== nextViewKey) return;
      if (error instanceof ApiError && error.status === 404) {
        this.cache.set(cacheKey, { missing: true });
        this._renderMessage('No Learnable Meta clue was found for this location.');
      } else {
        this._renderMessage(error.message || 'Could not load this Learnable Meta clue.', true);
      }
    }
  }

  _createWindow() {
    const root = element('aside', 'lm-clue-window hidden');
    root.setAttribute('aria-label', 'Learnable Meta clue');
    const header = element('div', 'lm-clue-header');
    const title = element('h2', '', 'Learnable Meta');
    const actions = element('div', 'lm-clue-header-actions');
    const website = iconControl('a', 'link-icon', 'Open Learnable Meta');
    website.href = 'https://learnablemeta.com/';
    website.target = '_blank';
    website.rel = 'noopener noreferrer';
    const reset = iconControl('button', 'refresh-icon', 'Reset clue window');
    reset.addEventListener('click', () => this.resetLayout());
    const close = iconControl('button', 'close-icon', 'Hide this clue');
    close.addEventListener('click', () => {
      this.closedViewKey = this.viewKey;
      this.hide();
    });
    actions.append(website, reset, close);
    header.append(title, actions);
    const content = element('div', 'lm-clue-content');
    content.setAttribute('aria-live', 'polite');
    root.append(header, content);
    this.header = header;
    this.content = content;
    return root;
  }

  _renderLoading() {
    const row = element('div', 'lm-clue-loading');
    const spinner = element('div', 'spinner');
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-label', 'Loading clue');
    row.append(spinner);
    this.content.replaceChildren(row);
  }

  _renderMessage(message, error = false) {
    const row = element('div', 'lm-clue-message', message);
    if (error) row.classList.add('error');
    this.content.replaceChildren(row);
  }

  async _renderClue(data, token, viewKey) {
    const images = await this._preloadImages(safeImageUrls(data?.images));
    if (token !== this.requestToken || this.viewKey !== viewKey) return;
    const fragment = document.createDocumentFragment();
    const heading = element('p', 'lm-clue-meta');
    const country = String(data?.country || '').trim();
    const metaName = String(data?.metaName || '').trim();
    if (country) heading.append(element('strong', '', country));
    if (country && metaName) heading.append(document.createTextNode(' - '));
    if (metaName) heading.append(document.createTextNode(metaName));
    if (heading.childNodes.length) fragment.append(heading);

    if (data?.note) {
      const note = element('div', 'lm-clue-note');
      note.append(sanitizeHtml(data.note));
      fragment.append(note);
    }
    if (data?.footer) {
      const footer = element('div', 'lm-clue-footer');
      if (images.length) footer.classList.add('before-images');
      footer.append(sanitizeHtml(data.footer));
      fragment.append(footer);
    }
    if (images.length) fragment.append(this._createCarousel(images));
    if (!fragment.childNodes.length) fragment.append(element('p', 'lm-clue-message', 'This clue has no content.'));
    this.content.replaceChildren(fragment);
  }

  async _preloadImages(urls) {
    const uniqueUrls = [...new Set(urls)];
    const loaded = await Promise.all(uniqueUrls.map((url) => this._preloadImage(url)));
    return loaded.filter(Boolean);
  }

  _preloadImage(url) {
    return new Promise((resolve) => {
      const image = new Image();
      let timer = 0;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        resolve(value);
      };
      timer = window.setTimeout(() => finish(null), IMAGE_LOAD_TIMEOUT_MS);
      image.decoding = 'async';
      image.onload = async () => {
        try { await image.decode(); } catch { /* loaded image can still be displayed */ }
        finish(url);
      };
      image.onerror = () => finish(null);
      image.src = url;
    });
  }

  _createCarousel(images) {
    let index = 0;
    const carousel = element('section', 'lm-clue-carousel');
    carousel.tabIndex = 0;
    carousel.setAttribute('aria-label', 'Clue images');
    const imageWrapper = element('div', 'lm-clue-image-wrapper');
    imageWrapper.setAttribute('role', 'img');
    imageWrapper.setAttribute('aria-label', 'Zoomable image');
    const image = element('img', 'lm-clue-image');
    image.loading = 'eager';
    image.decoding = 'async';
    const lens = element('div', 'lm-clue-image-lens hidden');
    const moveLens = (event) => {
      const rect = imageWrapper.getBoundingClientRect();
      const lensX = event.clientX - rect.left;
      const lensY = event.clientY - rect.top;
      lens.style.top = `${lensY - IMAGE_LENS_SIZE / 2}px`;
      lens.style.left = `${lensX - IMAGE_LENS_SIZE / 2}px`;
      lens.style.width = `${IMAGE_LENS_SIZE}px`;
      lens.style.height = `${IMAGE_LENS_SIZE}px`;
      lens.style.backgroundImage = `url("${image.src}")`;
      lens.style.backgroundRepeat = 'no-repeat';
      lens.style.backgroundSize = `${image.width * IMAGE_LENS_SCALE}px ${image.height * IMAGE_LENS_SCALE}px`;
      lens.style.backgroundPosition = `${-(lensX * IMAGE_LENS_SCALE - IMAGE_LENS_SIZE / 2)}px ${-(lensY * IMAGE_LENS_SCALE - IMAGE_LENS_SIZE / 2)}px`;
    };
    const showLens = (event) => {
      moveLens(event);
      lens.classList.remove('hidden');
    };
    const hideLens = () => lens.classList.add('hidden');
    imageWrapper.addEventListener('mouseenter', showLens);
    imageWrapper.addEventListener('mouseleave', hideLens);
    imageWrapper.addEventListener('mousemove', moveLens);
    imageWrapper.append(image, lens);
    const counter = element('span', 'lm-clue-image-count');
    const render = () => {
      image.src = images[index];
      image.alt = `Learnable Meta clue image ${index + 1} of ${images.length}`;
      counter.textContent = `${index + 1} / ${images.length}`;
    };
    carousel.append(imageWrapper);
    if (images.length > 1) {
      const previous = element('button', 'lm-clue-image-nav previous', '‹');
      const next = element('button', 'lm-clue-image-nav next', '›');
      previous.type = next.type = 'button';
      previous.setAttribute('aria-label', 'Previous clue image');
      next.setAttribute('aria-label', 'Next clue image');
      const move = (amount) => {
        index = (index + amount + images.length) % images.length;
        render();
      };
      previous.addEventListener('click', () => move(-1));
      next.addEventListener('click', () => move(1));
      carousel.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
      });
      carousel.append(previous, next, counter);
    }
    render();
    return carousel;
  }

  _bindLayout() {
    this.header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button, a')) return;
      const rect = this.root.getBoundingClientRect();
      this.drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      this.header.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    this.header.addEventListener('pointermove', (event) => {
      if (!this.drag || !this.header.hasPointerCapture(event.pointerId)) return;
      const rect = this.root.getBoundingClientRect();
      this.root.style.left = `${event.clientX - this.drag.x}px`;
      this.root.style.top = `${event.clientY - this.drag.y}px`;
      this._clampLayout(rect.width, rect.height);
    });
    const finishDrag = (event) => {
      if (!this.drag) return;
      this.drag = null;
      if (this.header.hasPointerCapture(event.pointerId)) this.header.releasePointerCapture(event.pointerId);
      this._persistLayout();
    };
    this.header.addEventListener('pointerup', finishDrag);
    this.header.addEventListener('pointercancel', finishDrag);
    window.addEventListener('resize', () => {
      this._clampLayout();
      this._persistLayout();
    });
    if ('ResizeObserver' in window) {
      let ready = false;
      const observer = new ResizeObserver(() => {
        if (!ready) { ready = true; return; }
        this._clampLayout();
        this._persistLayout();
      });
      observer.observe(this.root);
    }
  }

  _defaultLayout() {
    const width = Math.max(MIN_WIDTH, Math.min(DEFAULT_WIDTH, window.innerWidth - EDGE * 2));
    const height = Math.max(MIN_HEIGHT, Math.min(DEFAULT_HEIGHT, window.innerHeight - EDGE * 2));
    return {
      width,
      height,
      left: EDGE,
      top: EDGE
    };
  }

  _restoreLayout() {
    let layout = null;
    try { layout = JSON.parse(localStorage.getItem(LAYOUT_KEY)); } catch { /* use default */ }
    const valid = layout && ['left', 'top', 'width', 'height'].every((key) => Number.isFinite(layout[key]))
      && layout.width > 0 && layout.height > 0;
    this._applyLayout(valid ? layout : this._defaultLayout());
  }

  _applyLayout(layout) {
    this.root.style.left = `${layout.left}px`;
    this.root.style.top = `${layout.top}px`;
    this.root.style.width = `${layout.width}px`;
    this.root.style.height = `${layout.height}px`;
    this._clampLayout(layout.width, layout.height);
  }

  _clampLayout(width, height) {
    const rect = this.root.getBoundingClientRect();
    const styledWidth = parseFloat(this.root.style.width);
    const styledHeight = parseFloat(this.root.style.height);
    const requestedWidth = Number.isFinite(width) ? width : (rect.width || styledWidth || DEFAULT_WIDTH);
    const requestedHeight = Number.isFinite(height) ? height : (rect.height || styledHeight || DEFAULT_HEIGHT);
    const nextWidth = Math.max(MIN_WIDTH, Math.min(requestedWidth, window.innerWidth - EDGE * 2));
    const nextHeight = Math.max(MIN_HEIGHT, Math.min(requestedHeight, window.innerHeight - EDGE * 2));
    const left = Math.max(EDGE, Math.min(parseFloat(this.root.style.left) || EDGE, window.innerWidth - nextWidth - EDGE));
    const top = Math.max(EDGE, Math.min(parseFloat(this.root.style.top) || EDGE, window.innerHeight - nextHeight - EDGE));
    this.root.style.width = `${nextWidth}px`;
    this.root.style.height = `${nextHeight}px`;
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
  }

  _persistLayout() {
    if (this.root.classList.contains('hidden')) return;
    const rect = this.root.getBoundingClientRect();
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      }));
    } catch { /* private mode */ }
  }
}
