export const isNative = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const isAndroid = () =>
  typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
