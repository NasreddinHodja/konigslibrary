export type Toast = {
  id: string;
  label: string;
  current: number;
  total: number;
  phase: 'fetching' | 'packaging' | 'done' | 'error';
  cancel?: () => void;
};

const DISMISS_DELAY = 3000;

let toasts: Toast[] = $state([]);
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const getToasts = () => toasts;

export function addToast(toast: Toast): void {
  toasts.push(toast);
}

export function updateToast(id: string, updates: Partial<Toast>): void {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx < 0) return;
  Object.assign(toasts[idx], updates);

  if (updates.phase === 'done' || updates.phase === 'error') {
    clearTimeout(dismissTimers.get(id));
    dismissTimers.set(
      id,
      setTimeout(() => {
        removeToast(id);
      }, DISMISS_DELAY)
    );
  }
}

export function removeToast(id: string): void {
  clearTimeout(dismissTimers.get(id));
  dismissTimers.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
}

export function showError(message: string): void {
  const id = `error-${Date.now()}`;
  addToast({ id, label: message, current: 0, total: 0, phase: 'error' });
  dismissTimers.set(
    id,
    setTimeout(() => {
      removeToast(id);
    }, DISMISS_DELAY)
  );
}
