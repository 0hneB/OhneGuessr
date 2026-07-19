import { ApiError, getClue } from './api.js';
import { safeImageUrls, sanitizeHtml } from './sanitizer.js';

const LAYOUT_KEY = 'ohneguessr.learnableMeta.clue.layout';
const DEFAULT_WIDTH = 500;
const DEFAULT_HEIGHT = 400;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 220;
const EDGE = 12;

const isLearnableMap = (map) => map?.source?.type === 'learnable-meta';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
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

    const cacheKey = `${mapId}:${panoId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (cached.missing) this._renderMessage('No Learnable Meta clue was found for this location.');
      else this._renderClue(cached.data);
      return;
    }

    this._renderMessage('Loading clue…', true);
    const token = ++this.requestToken;
    try {
      const data = await getClue(mapId, panoId);
      if (token !== this.requestToken || this.viewKey !== nextViewKey) return;
      this.cache.set(cacheKey, { data });
      this._renderClue(data);
    } catch (error) {
      if (token !== this.requestToken || this.viewKey !== nextViewKey) return;
      if (error instanceof ApiError && error.status === 404) {
        this.cache.set(cacheKey, { missing: true });
        this._renderMessage('No Learnable Meta clue was found for this location.');
      } else {
        this._renderMessage(error.message || 'Could not load this Learnable Meta clue.', false, true);
      }
    }
  }

  resetLayout() {
    try { localStorage.removeItem(LAYOUT_KEY); } catch { /* private mode */ }
    this._applyLayout(this._defaultLayout());
    this._persistLayout();
  }

  _createWindow() {
    const root = element('aside', 'lm-clue-window hidden');
    root.setAttribute('aria-label', 'Learnable Meta clue');
    const header = element('div', 'lm-clue-header');
    const title = element('h2', '', 'Learnable Meta');
    const close = element('button', 'lm-clue-close', '×');
    close.type = 'button';
    close.title = 'Hide this clue';
    close.setAttribute('aria-label', 'Hide this clue');
    close.addEventListener('click', () => {
      this.closedViewKey = this.viewKey;
      this.hide();
    });
    header.append(title, close);
    const content = element('div', 'lm-clue-content');
    content.setAttribute('aria-live', 'polite');
    content.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[data-lm-external-link="true"]');
      if (!link || !content.contains(link)) return;
      event.preventDefault();
      const href = link.href;
      if (window.confirm(`Open this site in a new tab?\n\n${href}`)) {
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    });
    root.append(header, content);
    this.header = header;
    this.content = content;
    return root;
  }

  _renderMessage(message, loading = false, error = false) {
    const row = element('div', 'lm-clue-message', message);
    if (loading) row.classList.add('loading');
    if (error) row.classList.add('error');
    this.content.replaceChildren(row);
  }

  _renderClue(data) {
    const fragment = document.createDocumentFragment();
    const heading = element('p', 'lm-clue-meta');
    const country = String(data?.country || '').trim();
    const metaName = String(data?.metaName || '').trim();
    if (country) heading.append(element('strong', '', country));
    if (country && metaName) heading.append(document.createTextNode(' — '));
    if (metaName) heading.append(document.createTextNode(metaName));
    if (heading.childNodes.length) fragment.append(heading);

    if (data?.note) {
      const note = element('div', 'lm-clue-note');
      note.append(sanitizeHtml(data.note));
      fragment.append(note);
    }
    if (data?.footer) {
      const footer = element('div', 'lm-clue-footer');
      footer.append(sanitizeHtml(data.footer));
      fragment.append(footer);
    }
    const images = safeImageUrls(data?.images);
    if (images.length) fragment.append(this._createCarousel(images));
    if (!fragment.childNodes.length) fragment.append(element('p', 'lm-clue-message', 'This clue has no content.'));
    this.content.replaceChildren(fragment);
  }

  _createCarousel(images) {
    let index = 0;
    const carousel = element('section', 'lm-clue-carousel');
    carousel.tabIndex = 0;
    carousel.setAttribute('aria-label', 'Clue images');
    const image = element('img', 'lm-clue-image');
    image.loading = 'lazy';
    image.decoding = 'async';
    const counter = element('span', 'lm-clue-image-count');
    const render = () => {
      image.src = images[index];
      image.alt = `Learnable Meta clue image ${index + 1} of ${images.length}`;
      counter.textContent = `${index + 1} / ${images.length}`;
    };
    carousel.append(image);
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
      if (event.button !== 0 || event.target.closest('button')) return;
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
      left: Math.max(EDGE, window.innerWidth - width - 24),
      top: Math.max(EDGE, Math.min(72, window.innerHeight - height - EDGE))
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
