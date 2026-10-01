import { isNative } from '$lib/utils/platform';
import type { Reader } from '$lib/context';
import type { Plugin } from './types';

const DEFAULT_TITLE = 'konigslibrary';

async function setTitle(title: string) {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setTitle(title);
}

let unsubscribers: (() => void)[] = [];

export const windowTitlePlugin: Plugin = {
  name: 'window-title',

  install(reader: Reader) {
    if (!isNative()) return;
    unsubscribers = [
      reader.events.on('source:cleared', () => {
        setTitle(DEFAULT_TITLE);
      }),
      reader.events.on('meta:loaded', ({ title }) => {
        setTitle(`${title} - ${DEFAULT_TITLE}`);
      })
    ];
  },

  destroy() {
    for (const unsub of unsubscribers) unsub();
    unsubscribers = [];
  },

  onSourceLoaded(mangaName: string) {
    if (!isNative()) return;
    setTitle(`${mangaName} - ${DEFAULT_TITLE}`);
  }
};
