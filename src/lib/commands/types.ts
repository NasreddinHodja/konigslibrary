import type { ReaderServices } from '$lib/context';

export type CommandContext = {
  services: ReaderServices;
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
