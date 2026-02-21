import type { Command } from './types';

export const toggleSidebar: Command = {
  id: 'toggleSidebar',
  execute(ctx) {
    ctx.services.state.sidebarOpen = !ctx.services.state.sidebarOpen;
  }
};

export const closeSidebar: Command = {
  id: 'closeSidebar',
  execute(ctx) {
    ctx.services.state.sidebarOpen = false;
  }
};

export const back: Command = {
  id: 'back',
  execute(ctx) {
    ctx.services.clearManga();
  }
};

export const showHelp: Command = {
  id: 'showHelp',
  execute() {}
};
