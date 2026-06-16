import type { Command } from './types';

export const back: Command = {
  id: 'back',
  execute(ctx) {
    ctx.reader.clearManga();
  }
};

export const showHelp: Command = {
  id: 'showHelp',
  execute() {}
};
