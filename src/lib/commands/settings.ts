import type { Command } from './types';

export const toggleMode: Command = {
  id: 'toggleMode',
  execute(ctx) {
    if (ctx.services.state.sidebarOpen) ctx.services.toggleScrollMode();
  }
};

export const toggleRtlCmd: Command = {
  id: 'toggleRtl',
  execute(ctx) {
    if (ctx.services.state.sidebarOpen) ctx.services.toggleRtl();
  }
};

export const toggleDoublePageCmd: Command = {
  id: 'toggleDoublePage',
  execute(ctx) {
    if (ctx.services.state.sidebarOpen) ctx.services.toggleDoublePage();
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
