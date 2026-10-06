import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Layout from './+layout.svelte';
import { fakeServer, json } from '$lib/testing/server';
import { mockApp } from '$lib/testing/tauri';
import { apiFetch, login } from '$lib/api/auth.svelte';

// SvelteKit's router isn't running: navigation is recorded.
const nav = vi.hoisted(() => ({ goto: vi.fn(), replaceState: vi.fn() }));
vi.mock('$app/navigation', () => ({
  goto: nav.goto,
  replaceState: nav.replaceState,
  afterNavigate: () => {},
  onNavigate: () => {}
}));
const appPage = vi.hoisted(() => ({ state: {}, url: new URL('http://localhost/') }));
vi.mock('$app/state', () => ({ page: appPage }));

const page = createRawSnippet(() => ({ render: () => '<p>the page</p>' }));

function renderLayout() {
  render(Layout, { children: page });
}

describe('the layout', () => {
  it('shows the page', async () => {
    renderLayout();
    expect(screen.getByText('the page')).toBeInTheDocument();
  });

  describe('a request the server turns away for want of a session', () => {
    async function sessionRefused() {
      fakeServer(() => json({ error: 'Unauthorized' }, 401));
      await apiFetch('/api/library');
    }

    // The session state outlives the test; logging in again clears it.
    afterEach(async () => {
      fakeServer(() => json({ username: 'admin' }));
      await login('admin', 'password');
    });

    it('sends the app to the login screen', async () => {
      renderLayout();
      await sessionRefused();
      await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/login'));
    });

    it('leaves the login screen where it is', async () => {
      appPage.url = new URL('http://localhost/login');
      renderLayout();
      await sessionRefused();
      await new Promise((r) => setTimeout(r, 20));
      expect(nav.goto).not.toHaveBeenCalled();
      appPage.url = new URL('http://localhost/');
    });

    it('leaves Settings open, to change the server', async () => {
      appPage.url = new URL('http://localhost/settings');
      renderLayout();
      await sessionRefused();
      await new Promise((r) => setTimeout(r, 20));
      expect(nav.goto).not.toHaveBeenCalled();
      appPage.url = new URL('http://localhost/');
    });
  });

  describe('a long press on a touch screen', () => {
    const touchScreen = () =>
      vi
        .spyOn(window, 'matchMedia')
        .mockImplementation(
          (q) => ({ matches: q === '(pointer: coarse)', media: q }) as MediaQueryList
        );
    const longPress = (el: Element) => {
      const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    };

    it('opens no browser menu', async () => {
      touchScreen();
      renderLayout();
      expect(longPress(screen.getByText('the page'))).toBe(true);
    });

    it('still does in a text field', async () => {
      touchScreen();
      renderLayout();
      const input = document.body.appendChild(document.createElement('input'));
      expect(longPress(input)).toBe(false);
      input.remove();
    });

    it('is left alone with a mouse', async () => {
      renderLayout();
      expect(longPress(screen.getByText('the page'))).toBe(false);
    });
  });

  describe('in the app', () => {
    it("sends the page's uncaught errors to the log", async () => {
      const calls = mockApp();
      renderLayout();
      window.dispatchEvent(new ErrorEvent('error', { message: 'oops' }));
      expect(calls.find((c) => c.cmd === 'plugin:log|log')?.args).toMatchObject({
        message: expect.stringContaining('oops')
      });
    });

    it('offers to report the last crash', async () => {
      mockApp((cmd) => {
        if (cmd === 'take_crash_report') return 'boom';
      });
      renderLayout();
      expect(await screen.findByRole('dialog', { name: 'Crash report' })).toBeInTheDocument();
    });
  });
});
