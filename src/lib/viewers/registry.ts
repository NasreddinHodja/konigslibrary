import type { ViewerDefinition } from './types';

export class ViewerRegistry {
  private viewers: ViewerDefinition[] = [];

  register(viewer: ViewerDefinition): void {
    this.viewers.push(viewer);
    this.viewers.sort((a, b) => b.priority - a.priority);
  }

  resolve(state: { scrollMode: boolean }): ViewerDefinition | null {
    return this.viewers.find((v) => v.match(state)) ?? null;
  }

  getAll(): ViewerDefinition[] {
    return [...this.viewers];
  }
}
