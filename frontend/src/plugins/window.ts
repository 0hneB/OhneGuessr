import './window.css';

const DEFAULT_WIDTH = 450;
const DEFAULT_HEIGHT = 550;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 220;
const DEFAULT_INSET = 12;

interface WindowLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PluginWindowChrome {
  title: string;
  ariaLabel?: string;
  resetLabel?: string;
  closeLabel?: string;
  onClose?(): void;
}

export interface PluginWindowOptions extends PluginWindowChrome {
  layoutKey: string;
  link?: { href: string; label: string };
}

export interface PluginWindowHandle {
  readonly content: HTMLDivElement;
  configure(options: PluginWindowChrome): void;
  show(): void;
  hide(): void;
  resetLayout(): void;
  remove(): void;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function iconControl(tag: 'a', iconClass: string, label: string): HTMLAnchorElement;
function iconControl(tag: 'button', iconClass: string, label: string): HTMLButtonElement;
function iconControl(tag: 'a' | 'button', iconClass: string, label: string) {
  const control = element(tag, 'icon-action plugin-window-action');
  if (tag === 'button') control.type = 'button';
  control.title = label;
  control.setAttribute('aria-label', label);
  const icon = element('span', `svg-icon ${iconClass}`);
  icon.setAttribute('aria-hidden', 'true');
  control.append(icon);
  return control;
}

export function createPluginWindow(options: PluginWindowOptions): PluginWindowHandle {
  const root = element('aside', 'plugin-window hidden');
  const header = element('div', 'plugin-window-header');
  const heading = element('h2');
  const actions = element('div', 'plugin-window-header-actions');
  const content = element('div', 'plugin-window-content');
  content.setAttribute('aria-live', 'polite');

  let drag: { x: number; y: number } | null = null;
  let removed = false;
  let observer: ResizeObserver | null = null;
  let onClose = options.onClose;

  const defaultLayout = (): WindowLayout => ({
    width: Math.max(MIN_WIDTH, Math.min(DEFAULT_WIDTH, window.innerWidth - DEFAULT_INSET * 2)),
    height: Math.max(MIN_HEIGHT, Math.min(DEFAULT_HEIGHT, window.innerHeight - DEFAULT_INSET * 2)),
    left: DEFAULT_INSET,
    top: DEFAULT_INSET
  });
  const clampLayout = (width?: number, height?: number) => {
    const rect = root.getBoundingClientRect();
    const styledWidth = parseFloat(root.style.width);
    const styledHeight = parseFloat(root.style.height);
    const requestedWidth = width !== undefined && Number.isFinite(width)
      ? width : (rect.width || styledWidth || DEFAULT_WIDTH);
    const requestedHeight = height !== undefined && Number.isFinite(height)
      ? height : (rect.height || styledHeight || DEFAULT_HEIGHT);
    const nextWidth = Math.max(MIN_WIDTH, Math.min(requestedWidth, window.innerWidth));
    const nextHeight = Math.max(MIN_HEIGHT, Math.min(requestedHeight, window.innerHeight));
    const left = Math.max(0, Math.min(parseFloat(root.style.left) || 0, window.innerWidth - nextWidth));
    const top = Math.max(0, Math.min(parseFloat(root.style.top) || 0, window.innerHeight - nextHeight));
    root.style.width = `${nextWidth}px`;
    root.style.height = `${nextHeight}px`;
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  };
  const applyLayout = (layout: WindowLayout) => {
    root.style.left = `${layout.left}px`;
    root.style.top = `${layout.top}px`;
    root.style.width = `${layout.width}px`;
    root.style.height = `${layout.height}px`;
    clampLayout(layout.width, layout.height);
  };
  const persistLayout = () => {
    if (root.classList.contains('hidden')) return;
    const rect = root.getBoundingClientRect();
    try {
      localStorage.setItem(options.layoutKey, JSON.stringify({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      }));
    } catch { /* private mode */ }
  };
  const resetLayout = () => {
    applyLayout(defaultLayout());
    persistLayout();
  };
  const hide = () => root.classList.add('hidden');
  const show = () => {
    root.classList.remove('hidden');
    clampLayout();
  };

  if (options.link) {
    const website = iconControl('a', 'link-icon', options.link.label);
    website.href = options.link.href;
    website.target = '_blank';
    website.rel = 'noopener noreferrer';
    actions.append(website);
  }
  const reset = iconControl('button', 'refresh-icon', '');
  reset.addEventListener('click', resetLayout);
  const close = iconControl('button', 'close-icon', '');
  close.addEventListener('click', () => {
    hide();
    onClose?.();
  });
  const configure = (next: PluginWindowChrome) => {
    root.setAttribute('aria-label', next.ariaLabel || next.title);
    heading.textContent = next.title;
    reset.title = next.resetLabel || 'Reset window';
    reset.setAttribute('aria-label', reset.title);
    close.title = next.closeLabel || 'Close window';
    close.setAttribute('aria-label', close.title);
    onClose = next.onClose;
  };
  configure(options);
  actions.append(reset, close);
  header.append(heading, actions);
  root.append(header, content);
  document.body.append(root);

  let stored: unknown = null;
  try { stored = JSON.parse(localStorage.getItem(options.layoutKey) || 'null'); } catch { /* use default */ }
  const layout = stored as Partial<WindowLayout> | null;
  const valid = layout
    && typeof layout.left === 'number' && Number.isFinite(layout.left)
    && typeof layout.top === 'number' && Number.isFinite(layout.top)
    && typeof layout.width === 'number' && Number.isFinite(layout.width) && layout.width > 0
    && typeof layout.height === 'number' && Number.isFinite(layout.height) && layout.height > 0;
  applyLayout(valid ? layout as WindowLayout : defaultLayout());

  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 ||
        (event.target instanceof Element && event.target.closest('button, a'))) return;
    const rect = root.getBoundingClientRect();
    drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    header.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  header.addEventListener('pointermove', (event) => {
    if (!drag || !header.hasPointerCapture(event.pointerId)) return;
    const rect = root.getBoundingClientRect();
    root.style.left = `${event.clientX - drag.x}px`;
    root.style.top = `${event.clientY - drag.y}px`;
    clampLayout(rect.width, rect.height);
  });
  const finishDrag = (event: PointerEvent) => {
    if (!drag) return;
    drag = null;
    if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
    persistLayout();
  };
  header.addEventListener('pointerup', finishDrag);
  header.addEventListener('pointercancel', finishDrag);
  const onWindowResize = () => {
    clampLayout();
    persistLayout();
  };
  window.addEventListener('resize', onWindowResize);
  if ('ResizeObserver' in window) {
    let ready = false;
    observer = new ResizeObserver(() => {
      if (!ready) { ready = true; return; }
      clampLayout();
      persistLayout();
    });
    observer.observe(root);
  }

  return {
    content,
    configure,
    show,
    hide,
    resetLayout,
    remove() {
      if (removed) return;
      removed = true;
      window.removeEventListener('resize', onWindowResize);
      observer?.disconnect();
      root.remove();
    }
  };
}
