import type { Middleware } from './types';

export const wideDetectMw: Middleware = async (input, next, signal) => {
  const output = await next();
  if (signal.aborted || !input.services.state.doublePage || output.urls.length === 0) return output;

  const wide = new Set<number>();
  for (let i = 0; i < output.urls.length; i++) {
    if (signal.aborted) return output;
    let img = output.decoded.get(i);
    if (!img) {
      img = new Image();
      img.src = output.urls[i];
      try {
        await img.decode();
      } catch {
        /* ignore */
      }
    }
    if (img.naturalWidth > img.naturalHeight) wide.add(i);
  }
  if (!signal.aborted) output.widePages = wide;

  return output;
};
