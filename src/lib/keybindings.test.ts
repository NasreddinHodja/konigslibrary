import { describe, it, expect } from 'vitest';
import { DEFAULT_BINDINGS, formatKey } from '$lib/keybindings.svelte';

describe('formatKey', () => {
  it('maps arrow keys to unicode symbols', () => {
    expect(formatKey('ArrowUp')).toBe('\u2191');
    expect(formatKey('ArrowDown')).toBe('\u2193');
    expect(formatKey('ArrowLeft')).toBe('\u2190');
    expect(formatKey('ArrowRight')).toBe('\u2192');
  });

  it('maps Escape to Esc', () => {
    expect(formatKey('Escape')).toBe('Esc');
  });

  it('maps space to Space', () => {
    expect(formatKey(' ')).toBe('Space');
  });

  it('returns plain keys unchanged', () => {
    expect(formatKey('j')).toBe('j');
    expect(formatKey('?')).toBe('?');
  });
});

describe('DEFAULT_BINDINGS', () => {
  it('has no duplicate actions', () => {
    const actions = DEFAULT_BINDINGS.map((b) => b.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('every binding has at least one key', () => {
    for (const b of DEFAULT_BINDINGS) {
      expect(b.keys.length).toBeGreaterThan(0);
    }
  });

  it('every binding has a label and category', () => {
    for (const b of DEFAULT_BINDINGS) {
      expect(b.label).toBeTruthy();
      expect(b.category).toBeTruthy();
    }
  });

  it('has no duplicate key mappings across bindings', () => {
    const allKeys = DEFAULT_BINDINGS.flatMap((b) => b.keys);
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });
});
