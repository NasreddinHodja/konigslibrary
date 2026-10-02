import { goto } from '$app/navigation';
import { page } from '$app/state';

/// Leaves a page linked to from several places (settings, help): back to
/// wherever it was opened from, or to the library when it was opened directly.
export function backOrHome() {
  if (page.state.fromApp) history.back();
  else goto('/', { replaceState: true });
}

/// Android's system back on such a page does the same. For `$effect`.
export function nativeBackOrHome() {
  const onNativeBack = (e: Event) => {
    e.preventDefault();
    backOrHome();
  };
  window.addEventListener('nativeback', onNativeBack);
  return () => window.removeEventListener('nativeback', onNativeBack);
}
