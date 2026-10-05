import { ICONS } from '$lib/ui/icons';

// The icon fonts tried here. Unifont and Siji were tried too; Cozette won.
export const ICON_SETS: Record<string, { credit: string; icons: Record<string, string[]> }> = {
  cozette: { credit: 'Cozette 1.30.0, MIT', icons: ICONS }
};
