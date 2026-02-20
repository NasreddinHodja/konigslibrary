import type { Middleware } from './types';

export const decodeMw: Middleware = async (input, next, signal) => {
  const output = await next();
  if (signal.aborted) return output;

  const { urls } = output;
  const startPage = Math.max(0, Math.min(input.services.state.currentPage, urls.length - 1));
  const initialPages = [startPage];
  if (input.services.state.doublePage && startPage + 1 < urls.length) {
    initialPages.push(startPage + 1);
  }

  for (const idx of initialPages) {
    if (signal.aborted) return output;
    const img = new Image();
    img.src = urls[idx];
    try {
      await img.decode();
    } catch {
      /* ignore */
    }
    output.decoded.set(idx, img);
  }

  return output;
};
