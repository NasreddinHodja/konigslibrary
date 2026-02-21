export type Action =
  | 'nextPage'
  | 'prevPage'
  | 'nextPageRTL'
  | 'prevPageRTL'
  | 'nextChapter'
  | 'prevChapter'
  | 'toggleSidebar'
  | 'closeSidebar'
  | 'back'
  | 'showHelp'
  | 'toggleMode'
  | 'toggleRtl'
  | 'toggleDoublePage'
  | 'zoomIn'
  | 'zoomOut'
  | 'holdZoom';

export type KeyBinding = {
  action: Action;
  keys: string[];
  label: string;
  category: string;
};

const LS_KEY = 'kl:keybindings';

export const DEFAULT_BINDINGS: KeyBinding[] = [
  { action: 'nextPage', keys: ['j', 'ArrowDown'], label: 'Next page', category: 'Navigation' },
  { action: 'prevPage', keys: ['k', 'ArrowUp'], label: 'Previous page', category: 'Navigation' },
  {
    action: 'nextPageRTL',
    keys: ['l', 'ArrowRight'],
    label: 'Next page (LTR) / Prev (RTL)',
    category: 'Navigation'
  },
  {
    action: 'prevPageRTL',
    keys: ['h', 'ArrowLeft'],
    label: 'Prev page (LTR) / Next (RTL)',
    category: 'Navigation'
  },
  { action: 'nextChapter', keys: ['n', ']'], label: 'Next chapter', category: 'Navigation' },
  { action: 'prevChapter', keys: ['p', '['], label: 'Previous chapter', category: 'Navigation' },
  { action: 'holdZoom', keys: ['z'], label: 'Hold to zoom', category: 'Navigation' },
  { action: 'toggleSidebar', keys: ['s'], label: 'Toggle sidebar', category: 'UI' },
  { action: 'closeSidebar', keys: ['Escape'], label: 'Close sidebar / help', category: 'UI' },
  { action: 'back', keys: ['b'], label: 'Back to library', category: 'UI' },
  { action: 'showHelp', keys: ['?'], label: 'Toggle shortcut help', category: 'UI' },
  { action: 'toggleMode', keys: ['m'], label: 'Toggle scroll/turn mode', category: 'Settings' },
  { action: 'toggleRtl', keys: ['r'], label: 'Toggle LTR/RTL', category: 'Settings' },
  {
    action: 'toggleDoublePage',
    keys: ['d'],
    label: 'Toggle single/double page',
    category: 'Settings'
  },
  { action: 'zoomOut', keys: ['-'], label: 'Zoom out', category: 'Settings' },
  { action: 'zoomIn', keys: ['='], label: 'Zoom in', category: 'Settings' }
];

const browser = typeof localStorage !== 'undefined';

function loadBindings(): KeyBinding[] {
  if (!browser) return structuredClone(DEFAULT_BINDINGS);
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return structuredClone(DEFAULT_BINDINGS);
  try {
    const saved: Record<string, string[]> = JSON.parse(raw);
    return DEFAULT_BINDINGS.map((b) => ({
      ...b,
      keys: saved[b.action] ?? b.keys
    }));
  } catch {
    return structuredClone(DEFAULT_BINDINGS);
  }
}

function buildLookup(bindings: KeyBinding[]): Map<string, Action> {
  const map = new Map<string, Action>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  for (const b of bindings) {
    for (const key of b.keys) {
      map.set(key, b.action);
    }
  }
  return map;
}

let bindings: KeyBinding[] = $state(loadBindings());
const lookup: Map<string, Action> = $derived(buildLookup(bindings));

export function getBindings(): KeyBinding[] {
  return bindings;
}

export function setBindings(updated: KeyBinding[]) {
  bindings = updated;
  if (browser) {
    const toSave: Record<string, string[]> = {};
    for (const b of updated) {
      toSave[b.action] = b.keys;
    }
    localStorage.setItem(LS_KEY, JSON.stringify(toSave));
  }
}

export function resetBindings() {
  bindings = structuredClone(DEFAULT_BINDINGS);
  if (browser) localStorage.removeItem(LS_KEY);
}

export function resolveKey(key: string): Action | undefined {
  return lookup.get(key);
}

export function getKeysForAction(action: Action): string[] {
  const b = bindings.find((b) => b.action === action);
  return b?.keys ?? [];
}

export function formatKey(key: string): string {
  const names: Record<string, string> = {
    ArrowUp: '\u2191',
    ArrowDown: '\u2193',
    ArrowLeft: '\u2190',
    ArrowRight: '\u2192',
    Escape: 'Esc',
    ' ': 'Space'
  };
  return names[key] ?? key;
}
