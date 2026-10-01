// Touch feedback for the page's own gestures, from the Android bridge. A
// no-op elsewhere (desktop, the browser).

type Bridge = { hapticLongPress?: () => void };

export function hapticLongPress(): void {
  (window as unknown as { __kl?: Bridge }).__kl?.hapticLongPress?.();
}
