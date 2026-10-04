import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Layout from './+layout.svelte';
import { getToasts } from '$lib/ui/toast.svelte';
import { fakeServer, json } from '$lib/testing/server';
import { mockApp } from '$lib/testing/tauri';

// SvelteKit's router isn't running: navigation is recorded.
const nav = vi.hoisted(() => ({ goto: vi.fn(), replaceState: vi.fn() }));
vi.mock('$app/navigation', () => ({
  goto: nav.goto,
  replaceState: nav.replaceState,
  afterNavigate: () => {},
  onNavigate: () => {}
}));
vi.mock('$app/state', () => ({ page: { state: {} } }));

// The local build (LOCAL_BUILD) reads the key from its own address. A build
// flag: on for every test here, which the other tests don't mind.
vi.mock('$lib/utils/constants', async (original) => ({
  ...(await original<typeof import('$lib/utils/constants')>()),
  isLocalServer: true
}));

const page = createRawSnippet(() => ({ render: () => '<p>the page</p>' }));

function renderLayout() {
  render(Layout, { children: page });
}

describe('the layout', () => {
  it('shows the page', async () => {
    renderLayout();
    expect(screen.getByText('the page')).toBeInTheDocument();
  });

  it("takes the key from the server's link, then drops it from the address", async () => {
    history.replaceState(null, '', '/?key=abc&x=1');
    renderLayout();
    expect(localStorage.getItem('kl:serverKey')).toBe('abc');
    expect(nav.replaceState).toHaveBeenCalledOnce();
    expect(String(nav.replaceState.mock.calls[0][0])).toBe('http://localhost:3000/?x=1');
    history.replaceState(null, '', '/');
  });

  it('leaves the address alone without a key', async () => {
    renderLayout();
    expect(localStorage.getItem('kl:serverKey')).toBeNull();
    expect(nav.replaceState).not.toHaveBeenCalled();
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

  // Scanning the host's QR code opens the app with this link.
  describe('a connect link', () => {
    function openedWith(link: string) {
      mockApp((cmd) => {
        if (cmd === 'plugin:deep-link|get_current') return [link];
      });
    }

    it('connects to the server it names', async () => {
      openedWith('konigslibrary://connect?host=192.168.1.5&port=3000&key=abc');
      fakeServer((url) =>
        url.host === '192.168.1.5:3000' && url.searchParams.get('key') === 'abc'
          ? json({ entries: [], next: null })
          : undefined
      );
      renderLayout();
      await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/'));
      expect(localStorage.getItem('kl:serverUrl')).toBe('http://192.168.1.5:3000');
      expect(localStorage.getItem('kl:serverKey')).toBe('abc');
      expect(getToasts().map((t) => t.label)).toContain('Connected via QR code');
    });

    it('says why it could not connect', async () => {
      openedWith('konigslibrary://connect?host=192.168.1.5&port=3000&key=old');
      fakeServer(() => new Response('', { status: 401 }));
      renderLayout();
      await vi.waitFor(() => expect(getToasts().map((t) => t.label)).toContain('Wrong key'));
      expect(nav.goto).not.toHaveBeenCalled();
      expect(localStorage.getItem('kl:serverUrl')).toBeNull();
    });

    it('ignores any other link', async () => {
      openedWith('https://example.com/');
      const fetch = fakeServer(() => undefined);
      renderLayout();
      await new Promise((r) => setTimeout(r, 20));
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
