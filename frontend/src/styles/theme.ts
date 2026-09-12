import { publicAsset } from '../platform/assets.js';

export type LauncherTheme =
  | 'ohneguessr'
  | 'dark-mode'
  | 'ohneb'
  | 'gruvbox-dark-soft'
  | 'gruvbox-light-soft'
  | 'ayu-light'
  | 'ayu-mirage';

export const DEFAULT_ACCENT_COLOR = '#22c55e';

export const DEFAULT_LAUNCHER_THEME: LauncherTheme = 'ohneguessr';

export const LAUNCHER_THEMES = {
  ohneguessr: { label: 'OhneGuessr', accent: DEFAULT_ACCENT_COLOR },
  'dark-mode': { label: 'Dark Mode', accent: DEFAULT_ACCENT_COLOR },
  ohneb: { label: 'OhneB', accent: '#df783c' },
  'gruvbox-dark-soft': { label: 'Warm Dark', accent: '#83a598' },
  'gruvbox-light-soft': { label: 'Warm Light', accent: '#0b6678' },
  'ayu-light': { label: 'Cool Light', accent: '#3b9ee5' },
  'ayu-mirage': { label: 'Cool Dark', accent: '#72cffe' }
} satisfies Record<LauncherTheme, { label: string; accent: string }>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

let logoSvgPromise: Promise<string> | null = null;

export function normalizeAccentColor(value: unknown) {
  return typeof value === 'string' && HEX_COLOR.test(value)
    ? value.toLowerCase()
    : DEFAULT_ACCENT_COLOR;
}

export function normalizeLauncherTheme(value: unknown): LauncherTheme {
  return typeof value === 'string' && Object.hasOwn(LAUNCHER_THEMES, value)
    ? value as LauncherTheme
    : DEFAULT_LAUNCHER_THEME;
}

const channelHex = (value: number) => Math.round(value).toString(16).padStart(2, '0');

function applyFaviconAccent(color: string) {
  logoSvgPromise ||= fetch(publicAsset('images/ohneguessr-logo.svg')).then((res) => {
    if (!res.ok) throw new Error(`logo ${res.status}`);
    return res.text();
  });
  logoSvgPromise.then((source) => {
    const themed = source.replace(/#22c55e/gi, color);
    const href = `data:image/svg+xml,${encodeURIComponent(themed)}`;
    for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
      link.type = 'image/svg+xml';
      link.href = href;
    }
  }).catch(() => { /* keep the default favicon */ });
}

export function applyAccentColor(value: unknown) {
  const color = normalizeAccentColor(value);
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const linear = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  const target = luminance < 0.08 ? 255 : 0;
  const strong = color === DEFAULT_ACCENT_COLOR
    ? '#16a34a'
    : '#' + rgb.map((channel) => channelHex(channel + (target - channel) * 0.18)).join('');
  const ink = color === DEFAULT_ACCENT_COLOR
    ? '#06240f'
    : (luminance > 0.179 ? '#000000' : '#ffffff');

  const root = document.documentElement.style;
  root.setProperty('--accent', color);
  root.setProperty('--accent-strong', strong);
  root.setProperty('--accent-ink', ink);
  root.setProperty('--accent-rgb', rgb.join(', '));
  applyFaviconAccent(color);
  return color;
}
