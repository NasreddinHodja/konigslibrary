export type { Command, CommandContext, ViewerCommands } from './types';
export { CommandRegistry } from './registry';

import { CommandRegistry } from './registry';
import {
  nextPage,
  prevPage,
  nextPageRTL,
  prevPageRTL,
  nextChapter,
  prevChapter
} from './navigation';
import { toggleSidebar, closeSidebar, back, showHelp } from './ui';
import { toggleMode, toggleRtlCmd, toggleDoublePageCmd, zoomInCmd, zoomOutCmd } from './settings';

export function createDefaultRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(nextPage);
  registry.register(prevPage);
  registry.register(nextPageRTL);
  registry.register(prevPageRTL);
  registry.register(nextChapter);
  registry.register(prevChapter);
  registry.register(toggleSidebar);
  registry.register(closeSidebar);
  registry.register(back);
  registry.register(showHelp);
  registry.register(toggleMode);
  registry.register(toggleRtlCmd);
  registry.register(toggleDoublePageCmd);
  registry.register(zoomInCmd);
  registry.register(zoomOutCmd);
  return registry;
}
