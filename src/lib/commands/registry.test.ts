import { describe, it, expect, vi } from 'vitest';
import { CommandRegistry } from './registry';
import type { CommandContext } from './types';

const dummyCtx = {} as CommandContext;

describe('CommandRegistry', () => {
  it('registers and executes a command', () => {
    const registry = new CommandRegistry();
    const execute = vi.fn();
    registry.register({ id: 'test', execute });
    registry.execute('test', dummyCtx);
    expect(execute).toHaveBeenCalledWith(dummyCtx);
  });

  it('reports whether a command exists', () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'exists', execute: vi.fn() });
    expect(registry.has('exists')).toBe(true);
    expect(registry.has('missing')).toBe(false);
  });

  it('does not throw when executing an unknown command', () => {
    const registry = new CommandRegistry();
    expect(() => registry.execute('unknown', dummyCtx)).not.toThrow();
  });

  it('overwrites a command with the same id', () => {
    const registry = new CommandRegistry();
    const first = vi.fn();
    const second = vi.fn();
    registry.register({ id: 'dup', execute: first });
    registry.register({ id: 'dup', execute: second });
    registry.execute('dup', dummyCtx);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
