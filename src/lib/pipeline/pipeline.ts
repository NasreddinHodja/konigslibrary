import type { Middleware, PipelineInput, PipelineOutput } from './types';

export function createPipeline(middlewares: Middleware[]) {
  return async (input: PipelineInput, signal: AbortSignal): Promise<PipelineOutput> => {
    const base: PipelineOutput = {
      urls: input.urls,
      revoke: input.revoke,
      widePages: new Set(),
      decoded: new Map()
    };

    let idx = middlewares.length - 1;

    const run = async (): Promise<PipelineOutput> => {
      if (idx < 0) return base;
      const mw = middlewares[idx--];
      return mw(input, run, signal);
    };

    idx = middlewares.length - 1;
    return run();
  };
}
