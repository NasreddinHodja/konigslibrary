import type { Component } from 'svelte';

export type ViewerDefinition = {
  id: string;
  label: string;
  match(state: { scrollMode: boolean; doublePage: boolean }): boolean;
  component: Component<Record<string, unknown>>;
  priority: number;
};
