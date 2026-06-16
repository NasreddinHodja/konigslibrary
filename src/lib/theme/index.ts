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
    fg: '#485261',
    surface: '#f0f2f5',
    border: '#485261',
    muted: '#6b7a8a',
    readerBg: '#ffffff'
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    bg: '#1e1e2e',
    fg: '#cdd6f4',
    surface: '#181825',
    border: '#cdd6f4',
    muted: '#6c7086',
    readerBg: '#11111b'
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

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.style.setProperty('--color-bg', theme.bg);
  root.style.setProperty('--color-fg', theme.fg);
  root.style.setProperty('--color-surface', theme.surface);
  root.style.setProperty('--color-border', theme.border);
  root.style.setProperty('--color-muted', theme.muted);
  root.style.setProperty('--color-reader-bg', theme.readerBg);
}

export function initTheme() {
  applyTheme(getTheme());
}
