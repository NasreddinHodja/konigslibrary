import type { Command } from './types';

export const nextPage: Command = {
  id: 'nextPage',
  execute(ctx) {
    ctx.viewer?.nextPage();
  }
};

export const prevPage: Command = {
  id: 'prevPage',
  execute(ctx) {
    ctx.viewer?.prevPage();
  }
};

export const nextPageRTL: Command = {
  id: 'nextPageRTL',
  execute(ctx) {
    if (!ctx.viewer) return;
    if (ctx.services.state.rtl) ctx.viewer.prevPage();
    else ctx.viewer.nextPage();
  }
};

export const prevPageRTL: Command = {
  id: 'prevPageRTL',
  execute(ctx) {
    if (!ctx.viewer) return;
    if (ctx.services.state.rtl) ctx.viewer.nextPage();
    else ctx.viewer.prevPage();
  }
};

export const nextChapter: Command = {
  id: 'nextChapter',
  execute(ctx) {
    ctx.services.goToNextChapter();
  }
};

export const prevChapter: Command = {
  id: 'prevChapter',
  execute(ctx) {
    ctx.services.goToPrevChapter();
  }
};
