import { setContext, getContext } from 'svelte';
import type { Reader } from './types';

export type { Reader, MangaState } from './types';
export { createReader } from './create.svelte';

const CTX_KEY = Symbol('reader-services');

export function setReaderContext(reader: Reader): void {
  setContext(CTX_KEY, reader);
}

export function getReaderContext(): Reader {
  return getContext<Reader>(CTX_KEY);
}
