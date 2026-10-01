import { nativeBridge } from '$lib/utils/bridge';

export type Theme = {
  bg: string;
  fg: string;
  surface: string;
  border: string;
  muted: string;
  readerBg: string;
};

export type ThemePreset = Theme & { id: string; name: string };

const LS_THEME = 'kl:theme';

export const PRESETS: ThemePreset[] = [
  {
    id: 'default',
    name: 'Default',
    bg: '#000000',
    fg: '#ffffff',
    surface: '#000000',
    border: '#ffffff',
    muted: '#808080',
    readerBg: '#000000'
  },
  {
    id: 'cloud',
    name: 'Cloud',
    bg: '#f6f7f9',
    fg: '#0b1018',
    surface: '#f0f2f5',
    border: '#0b1018',
    muted: '#4a5563',
    readerBg: '#ffffff'
  },
  {
    // One Dark Pro's editor, sidebar and input backgrounds; its comment grey.
    // Text is its foreground (#abb2bf) brightened a quarter of the way to white.
    id: 'onedark',
    name: 'One Bark',
    bg: '#282c34',
    fg: '#c0c5cf',
    surface: '#21252b',
    border: '#c0c5cf',
    muted: '#7f848e',
    readerBg: '#1d1f23'
  }
];

export function getTheme(): Theme {
  if (typeof localStorage === 'undefined') return { ...PRESETS[0] };
  try {
    const raw = localStorage.getItem(LS_THEME);
    if (!raw) return { ...PRESETS[0] };
    return { ...PRESETS[0], ...(JSON.parse(raw) as Partial<Theme>) };
  } catch {
    return { ...PRESETS[0] };
  }
}

export function setTheme(theme: Theme) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LS_THEME, JSON.stringify(theme));
  }
  applyTheme(theme);
}

function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.style.setProperty('--color-bg', theme.bg);
  root.style.setProperty('--color-fg', theme.fg);
  root.style.setProperty('--color-surface', theme.surface);
  root.style.setProperty('--color-border', theme.border);
  root.style.setProperty('--color-muted', theme.muted);
  root.style.setProperty('--color-reader-bg', theme.readerBg);
  nativeBridge()?.setStatusBarStyle(isLightColor(theme.bg));
}

export function initTheme() {
  applyTheme(getTheme());
}
