import { ICONS } from '$lib/ui/icons';
import { COZETTE } from './cozette';

// The icon sets tried here. Unifont and Siji were tried too; Cozette won
// over them, then `grid9`, the app's own, over Cozette.
export const ICON_SETS: Record<string, { credit: string; icons: Record<string, string[]> }> = {
  grid9: { credit: 'drawn for the app, 9×9', icons: ICONS },
  cozette: { credit: 'Cozette 1.30.0, MIT', icons: COZETTE }
};

/// Every slot any set has, the app's first.
export const SLOTS = [...new Set(Object.values(ICON_SETS).flatMap((s) => Object.keys(s.icons)))];
