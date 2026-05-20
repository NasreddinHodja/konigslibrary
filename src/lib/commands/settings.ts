import type { Command } from './types';

export const toggleMode: Command = {
  id: 'toggleMode',
  execute(ctx) {
    ctx.services.toggleScrollMode();
  }
};

export const toggleRtlCmd: Command = {
  id: 'toggleRtl',
  execute(ctx) {
    ctx.services.toggleRtl();
  }
};

export const zoomInCmd: Command = {
  id: 'zoomIn',
  execute(ctx) {
    ctx.services.zoomIn();
  }
};

export const zoomOutCmd: Command = {
  id: 'zoomOut',
  execute(ctx) {
    ctx.services.zoomOut();
  }
};
