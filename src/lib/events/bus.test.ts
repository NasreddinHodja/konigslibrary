import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from './bus';

describe('EventBus', () => {
  it('delivers events to listeners', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('download:complete', handler);
    bus.emit('download:complete', { slug: 'test' });
    expect(handler).toHaveBeenCalledWith({ slug: 'test' });
  });

  it('supports multiple listeners for the same event', () => {
    const bus = createEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('source:cleared', a);
    bus.on('source:cleared', b);
    bus.emit('source:cleared', undefined as never);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('unsubscribes when calling the returned function', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    const unsub = bus.on('download:complete', handler);
    unsub();
    bus.emit('download:complete', { slug: 'test' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not throw when emitting with no listeners', () => {
    const bus = createEventBus();
    expect(() => bus.emit('source:cleared', undefined as never)).not.toThrow();
  });

  it('isolates different event types', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('download:complete', handler);
    bus.emit('download:error', { slug: 'test', error: 'fail' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('delivers payload correctly for typed events', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('progress:saved', handler);
    bus.emit('progress:saved', { chapter: 'ch01', page: 5 });
    expect(handler).toHaveBeenCalledWith({ chapter: 'ch01', page: 5 });
  });
});
