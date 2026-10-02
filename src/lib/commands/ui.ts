import type { Command } from './types';

export const back: Command = {
  id: 'back',
  execute() {
    // One layer up, as browser back: see src/routes/+page.svelte.
    history.back();
  }
};
