import type { Middleware } from './types';

export const decodeMw: Middleware = async (input, next, signal) => {
  const output = await next();
  if (signal.aborted) return output;

  const { urls } = output;
  const startPage = Math.max(0, Math.min(input.services.state.currentPage, urls.length - 1));

  if (!signal.aborted) {
    const img = new Image();
    img.src = urls[startPage];
    try {
      await img.decode();
    } catch {
      /* ignore */
    }
    output.decoded.set(startPage, img);
  }

  return output;
};
