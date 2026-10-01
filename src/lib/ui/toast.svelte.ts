import { SvelteMap } from 'svelte/reactivity';

export type Toast = {
  id: string;
  label: string;
  current: number;
  total: number;
  phase: 'fetching' | 'packaging' | 'deleting' | 'done' | 'error';
  cancel?: () => void;
  errorMessage?: string;
  /// Running downloads, which ToastStack folds into one past a few.
  group?: 'download';
};

const DISMISS_DELAY = 3000;
const ERROR_DISMISS_DELAY = 15000;

/// More running downloads than this fold into one toast.
const MAX_DOWNLOAD_TOASTS = 3;

let toasts: Toast[] = $state([]);
let downloadsFolded = $state(false);
const dismissTimers = new SvelteMap<string, ReturnType<typeof setTimeout>>();

export const getToasts = () => toasts;

/// Whether ToastStack shows the download toasts as one. Set once more than
/// MAX_DOWNLOAD_TOASTS run at once, and kept until every download toast is
/// gone (each leaves on its own timer once finished), so it doesn't flip back
/// and forth around the limit. Updated in the same call that changes the
/// toasts, so the stack never draws them unfolded first.
export const areDownloadsFolded = () => downloadsFolded;

function refold() {
  const downloads = toasts.filter((t) => t.group === 'download');
  const running = downloads.filter((t) => t.phase === 'fetching').length;
  if (running > MAX_DOWNLOAD_TOASTS) downloadsFolded = true;
  else if (downloads.length === 0) downloadsFolded = false;
}

export function addToast(toast: Toast): void {
  toasts.push(toast);
  refold();
}

export function updateToast(id: string, updates: Partial<Toast>): void {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx < 0) return;
  Object.assign(toasts[idx], updates);
  refold();

  if (updates.phase === 'done' || updates.phase === 'error') {
    clearTimeout(dismissTimers.get(id));
    const delay = updates.phase === 'error' ? ERROR_DISMISS_DELAY : DISMISS_DELAY;
    dismissTimers.set(
      id,
      setTimeout(() => {
        removeToast(id);
      }, delay)
    );
  }
}

export function removeToast(id: string): void {
  clearTimeout(dismissTimers.get(id));
  dismissTimers.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  refold();
}

let flashSeq = 0;

function flash(phase: 'done' | 'error', message: string): void {
  const id = `flash-${++flashSeq}`;
  addToast({ id, label: message, current: 0, total: 0, phase });
  dismissTimers.set(
    id,
    setTimeout(() => {
      removeToast(id);
    }, DISMISS_DELAY)
  );
}

export function showError(message: string): void {
  flash('error', message);
}

export function showSuccess(message: string): void {
  flash('done', message);
}
