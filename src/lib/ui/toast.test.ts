import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  addToast,
  updateToast,
  removeToast,
  getToasts,
  showError,
  showSuccess
} from './toast.svelte';
import type { Toast } from './toast.svelte';

function makeToast(overrides: Partial<Toast> = {}): Toast {
  return { id: 'test', label: 'Test', current: 0, total: 10, phase: 'fetching', ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
  getToasts()
    .slice()
    .forEach((t) => removeToast(t.id));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('addToast', () => {
  it('adds a toast to the list', () => {
    addToast(makeToast());
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0].id).toBe('test');
  });

  it('supports multiple toasts', () => {
    addToast(makeToast({ id: 'a' }));
    addToast(makeToast({ id: 'b' }));
    expect(getToasts()).toHaveLength(2);
  });
});

describe('updateToast', () => {
  it('updates fields on an existing toast', () => {
    addToast(makeToast({ id: 'upd' }));
    updateToast('upd', { current: 7, label: 'Updated' });
    expect(getToasts()[0].current).toBe(7);
    expect(getToasts()[0].label).toBe('Updated');
  });

  it('does nothing for an unknown id', () => {
    addToast(makeToast({ id: 'real' }));
    expect(() => updateToast('ghost', { current: 5 })).not.toThrow();
    expect(getToasts()[0].current).toBe(0);
  });

  it('auto-dismisses after 3s when phase becomes done', () => {
    addToast(makeToast({ id: 'done-test' }));
    updateToast('done-test', { phase: 'done' });
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(getToasts()).toHaveLength(0);
  });

  it('auto-dismisses after 15s when phase becomes error', () => {
    addToast(makeToast({ id: 'err-test' }));
    updateToast('err-test', { phase: 'error' });
    vi.advanceTimersByTime(3000);
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(12000);
    expect(getToasts()).toHaveLength(0);
  });

  it('resets the dismiss timer when phase changes again', () => {
    addToast(makeToast({ id: 'retrans' }));
    updateToast('retrans', { phase: 'done' });
    vi.advanceTimersByTime(1000);
    updateToast('retrans', { phase: 'error' });
    vi.advanceTimersByTime(3000);
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(12000);
    expect(getToasts()).toHaveLength(0);
  });
});

describe('removeToast', () => {
  it('removes a toast by id', () => {
    addToast(makeToast({ id: 'rm' }));
    removeToast('rm');
    expect(getToasts()).toHaveLength(0);
  });

  it('only removes the matching toast', () => {
    addToast(makeToast({ id: 'a' }));
    addToast(makeToast({ id: 'b' }));
    removeToast('a');
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0].id).toBe('b');
  });

  it('does not throw for an unknown id', () => {
    expect(() => removeToast('nonexistent')).not.toThrow();
  });

  it('cancels the dismiss timer so it does not fire after removal', () => {
    addToast(makeToast({ id: 'early-rm' }));
    updateToast('early-rm', { phase: 'done' });
    removeToast('early-rm');
    vi.advanceTimersByTime(5000);
    expect(getToasts()).toHaveLength(0);
  });
});

describe('showError', () => {
  it('adds a toast with phase error', () => {
    showError('Something failed');
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0].phase).toBe('error');
    expect(getToasts()[0].label).toBe('Something failed');
  });

  it('auto-dismisses after 3s', () => {
    showError('Oops');
    vi.advanceTimersByTime(3000);
    expect(getToasts()).toHaveLength(0);
  });
});

describe('showSuccess', () => {
  it('adds a toast with phase done', () => {
    showSuccess('All good');
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0].phase).toBe('done');
    expect(getToasts()[0].label).toBe('All good');
  });

  it('auto-dismisses after 3s', () => {
    showSuccess('Done!');
    vi.advanceTimersByTime(3000);
    expect(getToasts()).toHaveLength(0);
  });
});
