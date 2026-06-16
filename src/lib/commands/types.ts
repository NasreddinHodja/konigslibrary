import type { Reader } from '$lib/context';

export type CommandContext = {
  reader: Reader;
  viewer: ViewerCommands | null;
};

export type ViewerCommands = {
  nextPage(): void;
  prevPage(): void;
  holdZoom?(held: boolean): void;
};

export type Command = {
  id: string;
  execute(ctx: CommandContext): void;
};
