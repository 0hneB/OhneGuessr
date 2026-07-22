import { ApiError, getClue, type LearnableMetaClue } from './api.js';
import { safeImageUrls, sanitizeHtml } from './sanitizer.js';
import type { Location, MapItem } from '../../types.js';

const LAYOUT_KEY = 'ohneguessr.learnableMeta.clue.layout';
const DEFAULT_WIDTH = 450;
const DEFAULT_HEIGHT = 550;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 220;
const DEFAULT_INSET = 12;
const IMAGE_LOAD_TIMEOUT_MS = 12_000;
const IMAGE_LENS_SIZE = 150;
const IMAGE_LENS_SCALE = 2;
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const isLearnableMap = (map: MapItem | null | undefined) =>
  map?.source?.type === 'learnable-meta';

interface ClueView {
  map: MapItem | null;
  location: Location;
  roundIndex: number | null;
  context: 'result' | 'final';
}

interface ClueLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

type CacheEntry = { data: LearnableMetaClue; missing?: false } | { missing: true };

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text: string | null = null
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function iconControl(tag: 'a', iconClass: string, label: string): HTMLAnchorElement;
function iconControl(tag: 'button', iconClass: string, label: string): HTMLButtonElement;
function iconControl(tag: 'a' | 'button', iconClass: string, label: string) {
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
  private enabled = false;
  private readonly cache = new Map<string, CacheEntry>();
  private requestToken = 0;
  private viewKey: string | null = null;
  private closedViewKey: string | null = null;
  private drag: { x: number; y: number } | null = null;
  private readonly root: HTMLElementTagNameMap['aside'];
  private header!: HTMLDivElement;
  private content!: HTMLDivElement;

  constructor() {
    this.root = this._createWindow();
    document.body.appendChild(this.root);
    this._restoreLayout();
    this._bindLayout();
  }

  setEnabled(enabled: boolean) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.hide({ resetClose: true });
  }

  hide({ resetClose = false }: { resetClose?: boolean } = {}) {
    this.requestToken += 1;
    this.root.classList.add('hidden');
    if (resetClose) {
      this.viewKey = null;
      this.closedViewKey = null;
    }
  }

  resetLayout() {
    this._applyLayout(this._defaultLayout());
    this._persistLayout();
  }

  async show({ map, location, roundIndex, context }: ClueView) {
    if (!this.enabled || !isLearnableMap(map)) {
      this.hide({ resetClose: true });
      return;
    }
    const mapId = String(map?.source?.mapId || '');
    const panoId = location.panoid;
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
        this._renderMessage(errorMessage(error, 'Could not load this Learnable Meta clue.'), true);
      }
    }
  }

  _createWindow(): HTMLElementTagNameMap['aside'] {
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

  _renderMessage(message: string, error = false) {
    const row = element('div', 'lm-clue-message', message);
    if (error) row.classList.add('error');
    this.content.replaceChildren(row);
  }

  async _renderClue(data: LearnableMetaClue, token: number, viewKey: string) {
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

  async _preloadImages(urls: string[]) {
    const uniqueUrls = [...new Set(urls)];
    const loaded = await Promise.all(uniqueUrls.map((url) => this._preloadImage(url)));
    return loaded.filter((url): url is string => Boolean(url));
  }

  _preloadImage(url: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const image = new Image();
      let timer = 0;
      let settled = false;
      const finish = (value: string | null) => {
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

  _createCarousel(images: string[]) {
    let index = 0;
    const carousel = element('section', 'lm-clue-carousel');
    const imageWrapper = element('div', 'lm-clue-image-wrapper');
    const image = element('img', 'lm-clue-image');
    image.loading = 'eager';
    image.decoding = 'async';
    const lens = element('div', 'lm-clue-image-lens hidden');
    lens.style.width = `${IMAGE_LENS_SIZE}px`;
    lens.style.height = `${IMAGE_LENS_SIZE}px`;
    lens.style.backgroundRepeat = 'no-repeat';
    const moveLens = (event: MouseEvent) => {
      const rect = imageWrapper.getBoundingClientRect();
      const lensX = event.clientX - rect.left;
      const lensY = event.clientY - rect.top;
      lens.style.top = `${lensY - IMAGE_LENS_SIZE / 2}px`;
      lens.style.left = `${lensX - IMAGE_LENS_SIZE / 2}px`;
      lens.style.backgroundSize = `${image.width * IMAGE_LENS_SCALE}px ${image.height * IMAGE_LENS_SCALE}px`;
      lens.style.backgroundPosition = `${-(lensX * IMAGE_LENS_SCALE - IMAGE_LENS_SIZE / 2)}px ${-(lensY * IMAGE_LENS_SCALE - IMAGE_LENS_SIZE / 2)}px`;
    };
    const showLens = (event: MouseEvent) => {
      moveLens(event);
      lens.classList.remove('hidden');
    };
    const hideLens = () => lens.classList.add('hidden');
    imageWrapper.addEventListener('mouseenter', showLens);
    imageWrapper.addEventListener('mouseleave', hideLens);
    imageWrapper.addEventListener('mousemove', moveLens);
    imageWrapper.append(image, lens);
    let counter: HTMLSpanElement | null = null;
    const render = () => {
      image.src = images[index];
      image.alt = `Learnable Meta clue image ${index + 1} of ${images.length}`;
      lens.style.backgroundImage = `url("${image.src}")`;
      if (counter) counter.textContent = `${index + 1} / ${images.length}`;
    };
    carousel.append(imageWrapper);
    if (images.length > 1) {
      counter = element('span', 'lm-clue-image-count');
      const previous = element('button', 'lm-clue-image-nav previous', '‹');
      const next = element('button', 'lm-clue-image-nav next', '›');
      previous.type = next.type = 'button';
      previous.setAttribute('aria-label', 'Previous clue image');
      next.setAttribute('aria-label', 'Next clue image');
      const move = (amount: number) => {
        index = (index + amount + images.length) % images.length;
        render();
      };
      previous.addEventListener('click', () => move(-1));
      next.addEventListener('click', () => move(1));
      carousel.append(previous, next, counter);
    }
    render();
    return carousel;
  }

  _bindLayout() {
    this.header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 ||
          (event.target instanceof Element && event.target.closest('button, a'))) return;
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
    const finishDrag = (event: PointerEvent) => {
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

  _defaultLayout(): ClueLayout {
    const width = Math.max(MIN_WIDTH, Math.min(DEFAULT_WIDTH, window.innerWidth - DEFAULT_INSET * 2));
    const height = Math.max(MIN_HEIGHT, Math.min(DEFAULT_HEIGHT, window.innerHeight - DEFAULT_INSET * 2));
    return {
      width,
      height,
      left: DEFAULT_INSET,
      top: DEFAULT_INSET
    };
  }

  _restoreLayout() {
    let value: unknown = null;
    try { value = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null'); } catch { /* use default */ }
    const layout = value as Partial<ClueLayout> | null;
    const valid = layout &&
      typeof layout.left === 'number' && Number.isFinite(layout.left) &&
      typeof layout.top === 'number' && Number.isFinite(layout.top) &&
      typeof layout.width === 'number' && Number.isFinite(layout.width) && layout.width > 0 &&
      typeof layout.height === 'number' && Number.isFinite(layout.height) && layout.height > 0;
    this._applyLayout(valid ? layout as ClueLayout : this._defaultLayout());
  }

  _applyLayout(layout: ClueLayout) {
    this.root.style.left = `${layout.left}px`;
    this.root.style.top = `${layout.top}px`;
    this.root.style.width = `${layout.width}px`;
    this.root.style.height = `${layout.height}px`;
    this._clampLayout(layout.width, layout.height);
  }

  _clampLayout(width?: number, height?: number) {
    const rect = this.root.getBoundingClientRect();
    const styledWidth = parseFloat(this.root.style.width);
    const styledHeight = parseFloat(this.root.style.height);
    const requestedWidth = width !== undefined && Number.isFinite(width)
      ? width
      : (rect.width || styledWidth || DEFAULT_WIDTH);
    const requestedHeight = height !== undefined && Number.isFinite(height)
      ? height
      : (rect.height || styledHeight || DEFAULT_HEIGHT);
    const nextWidth = Math.max(MIN_WIDTH, Math.min(requestedWidth, window.innerWidth));
    const nextHeight = Math.max(MIN_HEIGHT, Math.min(requestedHeight, window.innerHeight));
    const left = Math.max(0, Math.min(parseFloat(this.root.style.left) || 0, window.innerWidth - nextWidth));
    const top = Math.max(0, Math.min(parseFloat(this.root.style.top) || 0, window.innerHeight - nextHeight));
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
