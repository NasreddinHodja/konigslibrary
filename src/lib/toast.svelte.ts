export type Toast = {
  id: string;
  label: string;
  current: number;
  total: number;
  phase: 'fetching' | 'packaging' | 'done' | 'error';
  cancel?: () => void;
};

let toasts: Toast[] = $state([]);

export const getToasts = () => toasts;

export function addToast(toast: Toast): void {
  toasts.push(toast);
}

export function updateToast(id: string, updates: Partial<Toast>): void {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx < 0) return;
  Object.assign(toasts[idx], updates);

  if (updates.phase === 'done' || updates.phase === 'error') {
    setTimeout(() => removeToast(id), 3000);
  }
}

export function removeToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
}
