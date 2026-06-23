import { describe, it, expect, vi } from 'vitest';
import {
  nextPage,
  prevPage,
  nextPageRTL,
  prevPageRTL,
  nextChapter,
  prevChapter
} from './navigation';
import type { CommandContext } from './types';

function makeCtx(rtl = false): CommandContext {
  return {
    reader: {
      state: { rtl },
      goToNextChapter: vi.fn(),
      goToPrevChapter: vi.fn()
    } as unknown as CommandContext['reader'],
    viewer: {
      nextPage: vi.fn(),
      prevPage: vi.fn()
    }
  };
}

describe('nextPage / prevPage', () => {
  it('nextPage calls viewer.nextPage', () => {
    const ctx = makeCtx();
    nextPage.execute(ctx);
    expect(ctx.viewer!.nextPage).toHaveBeenCalledOnce();
  });

  it('prevPage calls viewer.prevPage', () => {
    const ctx = makeCtx();
    prevPage.execute(ctx);
    expect(ctx.viewer!.prevPage).toHaveBeenCalledOnce();
  });

  it('nextPage does nothing when viewer is null', () => {
    const ctx = makeCtx();
    ctx.viewer = null;
    expect(() => nextPage.execute(ctx)).not.toThrow();
  });

  it('prevPage does nothing when viewer is null', () => {
    const ctx = makeCtx();
    ctx.viewer = null;
    expect(() => prevPage.execute(ctx)).not.toThrow();
  });
});

describe('nextPageRTL / prevPageRTL — RTL direction flip', () => {
  it('nextPageRTL calls viewer.nextPage in LTR mode', () => {
    const ctx = makeCtx(false);
    nextPageRTL.execute(ctx);
    expect(ctx.viewer!.nextPage).toHaveBeenCalledOnce();
    expect(ctx.viewer!.prevPage).not.toHaveBeenCalled();
  });

  it('nextPageRTL calls viewer.prevPage in RTL mode', () => {
    const ctx = makeCtx(true);
    nextPageRTL.execute(ctx);
    expect(ctx.viewer!.prevPage).toHaveBeenCalledOnce();
    expect(ctx.viewer!.nextPage).not.toHaveBeenCalled();
  });

  it('prevPageRTL calls viewer.prevPage in LTR mode', () => {
    const ctx = makeCtx(false);
    prevPageRTL.execute(ctx);
    expect(ctx.viewer!.prevPage).toHaveBeenCalledOnce();
    expect(ctx.viewer!.nextPage).not.toHaveBeenCalled();
  });

  it('prevPageRTL calls viewer.nextPage in RTL mode', () => {
    const ctx = makeCtx(true);
    prevPageRTL.execute(ctx);
    expect(ctx.viewer!.nextPage).toHaveBeenCalledOnce();
    expect(ctx.viewer!.prevPage).not.toHaveBeenCalled();
  });

  it('nextPageRTL does nothing when viewer is null', () => {
    const ctx = makeCtx(true);
    ctx.viewer = null;
    expect(() => nextPageRTL.execute(ctx)).not.toThrow();
  });
});

describe('nextChapter / prevChapter', () => {
  it('nextChapter calls reader.goToNextChapter', () => {
    const ctx = makeCtx();
    nextChapter.execute(ctx);
    expect(ctx.reader.goToNextChapter).toHaveBeenCalledOnce();
  });

  it('prevChapter calls reader.goToPrevChapter', () => {
    const ctx = makeCtx();
    prevChapter.execute(ctx);
    expect(ctx.reader.goToPrevChapter).toHaveBeenCalledOnce();
  });
});
