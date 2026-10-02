import { SvelteMap } from 'svelte/reactivity';
import { errorMessage } from '$lib/utils/errors';

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

let seq = 0;

/// A toast id that no other toast has, e.g. `del-3`.
export const toastId = (prefix: string): string => `${prefix}-${++seq}`;

/// Runs `work` under a toast that counts what it reports through `progress`,
/// then ends done, or as an error with the message (and rethrows).
export async function withProgressToast<T>(
  label: string,
  phase: Toast['phase'],
  work: (progress: (p: { current: number; total: number }) => void) => Promise<T>
): Promise<T> {
  const id = toastId('progress');
  addToast({ id, label, current: 0, total: 0, phase });
  try {
    const result = await work((p) => updateToast(id, p));
    updateToast(id, { phase: 'done' });
    return result;
  } catch (err) {
    updateToast(id, { phase: 'error', errorMessage: errorMessage(err) });
    throw err;
  }
}

/// Ends a toast that counted a batch: done, or an error saying how many failed.
export function finishBatchToast(
  id: string,
  failed: number,
  total: number,
  extra: Partial<Toast> = {}
): void {
  updateToast(
    id,
    failed
      ? { ...extra, phase: 'error', errorMessage: `${failed} of ${total} failed` }
      : { ...extra, phase: 'done' }
  );
}

function flash(phase: 'done' | 'error', message: string): void {
  const id = toastId('flash');
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
