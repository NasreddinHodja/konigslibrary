import { isNative } from '$lib/utils/platform';
import type { ReaderServices } from '$lib/context';
import type { Plugin } from './types';

const DEFAULT_TITLE = 'Konigslibrary';

async function setTitle(title: string) {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setTitle(title);
}

export const windowTitlePlugin: Plugin = {
  name: 'window-title',

  install(services: ReaderServices) {
    if (!isNative()) return;
    services.events.on('source:cleared', () => {
      setTitle(DEFAULT_TITLE);
    });
  },

  onSourceLoaded(mangaName: string) {
    if (!isNative()) return;
    setTitle(`${mangaName} — ${DEFAULT_TITLE}`);
  }
};
