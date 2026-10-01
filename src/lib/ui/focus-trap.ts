import type { Attachment } from 'svelte/attachments';

const FOCUSABLE = 'a[href], button, [tabindex]:not([tabindex="-1"])';

/// Moves focus into the element, keeps Tab cycling inside it, and gives focus
/// back to whatever had it once the element goes away.
export const focusTrap: Attachment<HTMLElement> = (node) => {
  const previousFocus = document.activeElement as HTMLElement | null;
  node.querySelector<HTMLElement>(FOCUSABLE)?.focus();

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  window.addEventListener('keydown', onKeydown);
  return () => {
    window.removeEventListener('keydown', onKeydown);
    previousFocus?.focus();
  };
};
