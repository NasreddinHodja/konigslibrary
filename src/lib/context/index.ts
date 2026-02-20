import { setContext, getContext } from 'svelte';
import type { ReaderServices } from './types';

export type { ReaderServices, MangaState } from './types';
export { createReaderServices } from './create.svelte';

const CTX_KEY = Symbol('reader-services');

export function setReaderContext(services: ReaderServices): void {
  setContext(CTX_KEY, services);
}

export function getReaderContext(): ReaderServices {
  return getContext<ReaderServices>(CTX_KEY);
}
