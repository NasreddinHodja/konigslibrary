import type { ViewerDefinition } from './types';
import PageScrollViewer from './PageScrollViewer.svelte';
import PageTurnViewer from './PageTurnViewer.svelte';

export const scrollViewer: ViewerDefinition = {
  id: 'scroll',
  label: 'Scroll',
  match: (state) => state.scrollMode,
  component: PageScrollViewer,
  priority: 10
};

export const pageTurnViewer: ViewerDefinition = {
  id: 'page-turn',
  label: 'Page Turn',
  match: () => true, // fallback
  component: PageTurnViewer,
  priority: 0
};
