import type { Command } from './types';

export const toggleMode: Command = {
  id: 'toggleMode',
  execute(ctx) {
    ctx.reader.toggleScrollMode();
  }
};

export const toggleRtlCmd: Command = {
  id: 'toggleRtl',
  execute(ctx) {
    ctx.reader.toggleRtl();
  }
};

export const zoomInCmd: Command = {
  id: 'zoomIn',
  execute(ctx) {
    ctx.reader.zoomIn();
  }
};

export const zoomOutCmd: Command = {
  id: 'zoomOut',
  execute(ctx) {
    ctx.reader.zoomOut();
  }
};
