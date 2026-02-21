import { describe, it, expect, vi } from 'vitest';
import { createPipeline } from './pipeline';
import type { Middleware, PipelineInput } from './types';
import type { ReaderServices } from '$lib/context';

function makeInput(urls: string[]): PipelineInput {
  return { urls, revoke: false, services: {} as ReaderServices };
}

describe('createPipeline', () => {
  it('returns base output with no middlewares', async () => {
    const pipeline = createPipeline([]);
    const result = await pipeline(makeInput(['a.png', 'b.png']), new AbortController().signal);
    expect(result.urls).toEqual(['a.png', 'b.png']);
    expect(result.decoded).toBeInstanceOf(Map);
  });

  it('runs a single middleware that modifies urls', async () => {
    const mw: Middleware = async (input, next) => {
      const base = await next();
      return { ...base, urls: base.urls.map((u) => u.toUpperCase()) };
    };
    const pipeline = createPipeline([mw]);
    const result = await pipeline(makeInput(['a.png']), new AbortController().signal);
    expect(result.urls).toEqual(['A.PNG']);
  });

  it('chains middlewares in correct order (last wraps first)', async () => {
    const order: number[] = [];
    const mw1: Middleware = async (_input, next) => {
      order.push(1);
      return next();
    };
    const mw2: Middleware = async (_input, next) => {
      order.push(2);
      return next();
    };
    const pipeline = createPipeline([mw1, mw2]);
    await pipeline(makeInput([]), new AbortController().signal);
    expect(order).toEqual([2, 1]);
  });

  it('passes abort signal to middlewares', async () => {
    const controller = new AbortController();
    const spy = vi.fn();
    const mw: Middleware = async (_input, next, signal) => {
      spy(signal.aborted);
      return next();
    };
    const pipeline = createPipeline([mw]);
    controller.abort();
    await pipeline(makeInput([]), controller.signal);
    expect(spy).toHaveBeenCalledWith(true);
  });
});
