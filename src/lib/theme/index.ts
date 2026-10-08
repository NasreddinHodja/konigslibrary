import { nativeBridge } from '$lib/utils/bridge';
import { textureUrl } from './dither';

/// A palette: background, text, and the ink for borders, links, buttons and
/// every state. The rest is mixed from these (docs/design/system.org).
export type Theme = {
  bg: string;
  fg: string;
  ink: string;
};

export type ThemePreset = Theme & { id: string; name: string };

const LS_THEME = 'kl:theme';

export const PRESETS: ThemePreset[] = [
  { id: 'dawn', name: 'dawn', bg: '#f3f2fa', fg: '#1d2140', ink: '#8a2560' },
  { id: 'dusk', name: 'dusk', bg: '#171a2b', fg: '#ece6f3', ink: '#f7b2d6' },
  { id: 'onebark', name: 'one bark', bg: '#282c34', fg: '#dcdfe4', ink: '#c678dd' },
  { id: 'bubblegum', name: 'bubblegum', bg: '#000000', fg: '#ffe0f0', ink: '#ff8fc8' },
  { id: 'paper', name: 'paper', bg: '#f4f0e8', fg: '#141414', ink: '#141414' },
  { id: 'white', name: 'white', bg: '#000000', fg: '#ffffff', ink: '#ffffff' }
];

const HEX = /^#[0-9a-f]{6}$/i;

/// A saved theme, as any version wrote it: before the three-colour palettes
/// the ink was `border`.
function fromSaved(saved: Record<string, unknown>): Theme {
  const pick = (v: unknown, fallback: string) =>
    typeof v === 'string' && HEX.test(v) ? v : fallback;
  const base = PRESETS[0];
  return {
    bg: pick(saved.bg, base.bg),
    fg: pick(saved.fg, base.fg),
    ink: pick(saved.ink ?? saved.border, base.ink)
  };
}

export function getTheme(): Theme {
  const base = { bg: PRESETS[0].bg, fg: PRESETS[0].fg, ink: PRESETS[0].ink };
  if (typeof localStorage === 'undefined') return base;
  try {
    const raw = localStorage.getItem(LS_THEME);
    return raw ? fromSaved(JSON.parse(raw)) : base;
  } catch {
    return base;
  }
}

export function setTheme(theme: Theme) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LS_THEME, JSON.stringify({ bg: theme.bg, fg: theme.fg, ink: theme.ink }));
  }
  applyTheme(theme);
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const lightness = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/// `a` at `amount` over `b`, as CSS's `color-mix(in srgb, …)` makes it.
export function mix(a: string, b: string, amount: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return (
    '#' +
    x
      .map((v, i) =>
        Math.round(v * amount + y[i] * (1 - amount))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}

/// Hover: the ink moved away from the background, so it stands out more. An
/// ink already at that end (white on black) moves back toward the
/// background instead.
export function hover(theme: Theme): string {
  const away = mix(theme.ink, lightness(theme.bg) < 0.5 ? '#ffffff' : '#000000', 0.6);
  return Math.abs(lightness(away) - lightness(theme.ink)) < 0.08
    ? mix(theme.ink, theme.bg, 0.75)
    : away;
}

/// The texture shown now, and how many have been asked for.
let texture: string | null = null;
let textureCall = 0;

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.style.setProperty('--color-bg', theme.bg);
  root.style.setProperty('--color-fg', theme.fg);
  root.style.setProperty('--color-ink', theme.ink);
  root.style.setProperty('--color-hi', hover(theme));
  const call = ++textureCall;
  textureUrl(theme.bg, mix(theme.ink, theme.bg, 0.6)).then((url) => {
    // A later theme's texture wins, and the one it replaces is let go.
    if (call !== textureCall) {
      if (url) URL.revokeObjectURL(url);
      return;
    }
    if (texture) URL.revokeObjectURL(texture);
    texture = url;
    root.style.setProperty('--texture', url ? `url(${url})` : 'none');
  });
  nativeBridge()?.setStatusBarStyle(lightness(theme.bg) > 0.5);
}

export function initTheme() {
  applyTheme(getTheme());
}
