import type { Command, CommandContext } from './types';

export class CommandRegistry {
  private commands = new Map<string, Command>();

  register(command: Command): void {
    this.commands.set(command.id, command);
  }

  execute(id: string, ctx: CommandContext): void {
    const cmd = this.commands.get(id);
    if (cmd) cmd.execute(ctx);
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }
}
