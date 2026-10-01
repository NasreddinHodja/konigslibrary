/// The Android app's JavaScript interface (`MainActivity.kt`), exposed as
/// `window.__kl`. Absent everywhere else (desktop, the browser).
type NativeBridge = {
  setImmersive(hidden: boolean): void;
  setStatusBarStyle(light: boolean): void;
  acquireWakeLock(label: string, total: number): void;
  updateDownloadProgress(current: number, total: number): void;
  releaseWakeLock(): void;
  systemGestureInsets?(): string;
  hapticLongPress?(): void;
};

export function nativeBridge(): NativeBridge | undefined {
  return (window as unknown as { __kl?: NativeBridge }).__kl;
}
