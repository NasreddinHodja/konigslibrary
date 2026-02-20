import type { ReaderServices } from '$lib/context';
import type { Plugin } from './types';

export class PluginRunner {
  private plugins: Plugin[] = [];
  private unsubscribers: (() => void)[] = [];

  register(plugin: Plugin): void {
    this.plugins.push(plugin);
  }

  start(services: ReaderServices): void {
    for (const plugin of this.plugins) {
      plugin.install?.(services);
    }

    this.unsubscribers.push(
      services.events.on('source:loaded', ({ mangaName }) => {
        for (const p of this.plugins) p.onSourceLoaded?.(mangaName);
      })
    );

    this.unsubscribers.push(
      services.events.on('chapter:changed', ({ from, to }) => {
        for (const p of this.plugins) p.onChapterChanged?.(from, to);
      })
    );

    this.unsubscribers.push(
      services.events.on('progress:saved', ({ page }) => {
        for (const p of this.plugins) p.onPageChanged?.(page);
      })
    );
  }

  destroy(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    for (const plugin of this.plugins) plugin.destroy?.();
  }
}
