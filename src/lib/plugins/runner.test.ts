import { describe, it, expect, vi } from 'vitest';
import { PluginRunner } from './runner';
import { createEventBus } from '$lib/events/bus';
import type { Reader } from '$lib/context/types';

function makeReader(): Reader {
  const events = createEventBus();
  return { events } as unknown as Reader;
}

describe('PluginRunner', () => {
  it('calls install on each registered plugin', () => {
    const runner = new PluginRunner();
    const install = vi.fn();
    runner.register({ name: 'test', install });
    const reader = makeReader();
    runner.start(reader);
    expect(install).toHaveBeenCalledWith(reader);
  });

  it('forwards source:loaded to onSourceLoaded', () => {
    const runner = new PluginRunner();
    const onSourceLoaded = vi.fn();
    runner.register({ name: 'test', onSourceLoaded });
    const reader = makeReader();
    runner.start(reader);
    reader.events.emit('source:loaded', { kind: 'zip', mangaName: 'MyManga' });
    expect(onSourceLoaded).toHaveBeenCalledWith('MyManga');
  });

  it('forwards chapter:changed to onChapterChanged', () => {
    const runner = new PluginRunner();
    const onChapterChanged = vi.fn();
    runner.register({ name: 'test', onChapterChanged });
    const reader = makeReader();
    runner.start(reader);
    reader.events.emit('chapter:changed', { from: 'ch01', to: 'ch02' });
    expect(onChapterChanged).toHaveBeenCalledWith('ch01', 'ch02');
  });

  it('forwards progress:saved to onPageChanged', () => {
    const runner = new PluginRunner();
    const onPageChanged = vi.fn();
    runner.register({ name: 'test', onPageChanged });
    const reader = makeReader();
    runner.start(reader);
    reader.events.emit('progress:saved', { chapter: 'ch01', page: 5 });
    expect(onPageChanged).toHaveBeenCalledWith(5);
  });

  it('unsubscribes all events after destroy()', () => {
    const runner = new PluginRunner();
    const onSourceLoaded = vi.fn();
    runner.register({ name: 'test', onSourceLoaded });
    const reader = makeReader();
    runner.start(reader);
    runner.destroy();
    reader.events.emit('source:loaded', { kind: 'zip', mangaName: 'MyManga' });
    expect(onSourceLoaded).not.toHaveBeenCalled();
  });

  it('calls destroy on each plugin when runner is destroyed', () => {
    const runner = new PluginRunner();
    const destroy = vi.fn();
    runner.register({ name: 'test', destroy });
    const reader = makeReader();
    runner.start(reader);
    runner.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('handles plugins with no optional hooks without throwing', () => {
    const runner = new PluginRunner();
    runner.register({ name: 'minimal' });
    const reader = makeReader();
    expect(() => runner.start(reader)).not.toThrow();
    expect(() =>
      reader.events.emit('source:loaded', { kind: 'zip', mangaName: 'X' })
    ).not.toThrow();
    expect(() => runner.destroy()).not.toThrow();
  });

  it('broadcasts events to all registered plugins', () => {
    const runner = new PluginRunner();
    const a = vi.fn();
    const b = vi.fn();
    runner.register({ name: 'a', onSourceLoaded: a });
    runner.register({ name: 'b', onSourceLoaded: b });
    const reader = makeReader();
    runner.start(reader);
    reader.events.emit('source:loaded', { kind: 'zip', mangaName: 'Manga' });
    expect(a).toHaveBeenCalledWith('Manga');
    expect(b).toHaveBeenCalledWith('Manga');
  });
});
