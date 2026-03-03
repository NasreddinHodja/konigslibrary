import type { Middleware, PipelineInput, PipelineOutput } from './types';

export function createPipeline(middlewares: Middleware[]) {
  return async (input: PipelineInput, signal: AbortSignal): Promise<PipelineOutput> => {
    const base: PipelineOutput = {
      urls: input.urls,
      revoke: input.revoke,
      decoded: new Map()
    };

    // Middlewares run last-to-first: the last registered runs first and calls
    // `run` to delegate to the next one up the chain.
    let idx = middlewares.length - 1;

    const run = async (): Promise<PipelineOutput> => {
      if (idx < 0) return base;
      const mw = middlewares[idx--];
      return mw(input, run, signal);
    };

    return run();
  };
}
