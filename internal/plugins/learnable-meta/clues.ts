import { ApiError, getClue, type LearnableMetaClue } from './api.js';
import { safeImageUrls, sanitizeHtml } from './sanitizer.js';
import {
  createPluginWindow,
  type PluginWindowHandle
} from '../../../frontend/src/plugins/window.js';
import type { Location, MapItem } from '../../../frontend/src/types.js';

const LAYOUT_KEY = 'ohneguessr.learnableMeta.clue.layout';
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

export class LearnableMetaClues {
  private enabled = false;
  private readonly cache = new Map<string, Promise<LearnableMetaClue | null>>();
  private requestToken = 0;
  private viewKey: string | null = null;
  private closedViewKey: string | null = null;
  private readonly window: PluginWindowHandle;
  private readonly content: HTMLDivElement;

  constructor() {
    this.window = createPluginWindow({
      title: 'Learnable Meta',
      ariaLabel: 'Learnable Meta clue',
      layoutKey: LAYOUT_KEY,
      link: { href: 'https://learnablemeta.com/', label: 'Open Learnable Meta' },
      resetLabel: 'Reset clue window',
      closeLabel: 'Hide this clue',
      onClose: () => {
        this.closedViewKey = this.viewKey;
        this.requestToken += 1;
      }
    });
    this.content = this.window.content;
  }

  setEnabled(enabled: boolean) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.hide({ resetClose: true });
  }

  hide({ resetClose = false }: { resetClose?: boolean } = {}) {
    this.requestToken += 1;
    this.window.hide();
    if (resetClose) {
      this.viewKey = null;
      this.closedViewKey = null;
    }
  }

  resetLayout() {
    this.window.resetLayout();
  }

  preload({ map, location }: Pick<ClueView, 'map' | 'location'>) {
    if (!this.enabled || !isLearnableMap(map)) return;
    const mapId = String(map?.source?.mapId || '');
    const panoId = location.panoid;
    if (mapId && panoId) void this._load(mapId, panoId).catch(() => {});
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

    this.window.show();
    if (!mapId || !panoId) {
      this._renderMessage('No panorama ID is available for this clue.');
      return;
    }

    const token = ++this.requestToken;
    this._renderLoading();
    try {
      const data = await this._load(mapId, panoId);
      if (token !== this.requestToken || this.viewKey !== nextViewKey) return;
      if (data) this._renderClue(data);
      else this._renderMessage('No Learnable Meta clue was found for this location.');
    } catch (error) {
      if (token !== this.requestToken || this.viewKey !== nextViewKey) return;
      this._renderMessage(errorMessage(error, 'Could not load this Learnable Meta clue.'), true);
    }
  }

  private _load(mapId: string, panoId: string) {
    const key = `${mapId}:${panoId}`;
    let request = this.cache.get(key);
    if (request) return request;
    request = getClue(mapId, panoId)
      .then((data) => {
        const imageUrl = safeImageUrls(data.images)[0];
        if (imageUrl) {
          const image = new Image();
          image.src = imageUrl;
          void image.decode().catch(() => {});
        }
        return data;
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) return null;
        this.cache.delete(key);
        throw error;
      });
    this.cache.set(key, request);
    return request;
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

  _renderClue(data: LearnableMetaClue) {
    const images = [...new Set(safeImageUrls(data?.images))];
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

}
