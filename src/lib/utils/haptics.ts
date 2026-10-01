// Touch feedback for the page's own gestures, from the Android bridge. A
// no-op elsewhere (desktop, the browser).

import { nativeBridge } from './bridge';

export function hapticLongPress(): void {
  nativeBridge()?.hapticLongPress?.();
}
