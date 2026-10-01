import type { Component } from 'svelte';
import type { ChapterState } from '$lib/chapter-loader';
import type { ViewerCommands } from '$lib/commands';

/// What ReaderScreen passes every viewer.
export type ViewerProps = {
  chapter: ChapterState;
  commands?: ViewerCommands | null;
  ontap?: () => void;
};

export type ViewerDefinition = {
  id: string;
  label: string;
  match(state: { scrollMode: boolean }): boolean;
  component: Component<ViewerProps, Record<string, never>, 'commands'>;
  priority: number;
};
