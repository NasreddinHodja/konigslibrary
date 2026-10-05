import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/svelte';
import Settings from './+page.svelte';
import { resetBindings, resolveKey } from '$lib/keyboard/keybindings.svelte';
import { applyTheme, PRESETS } from '$lib/theme';
import { getToasts } from '$lib/ui/toast.svelte';
import { fakeServer, json } from '$lib/testing/server';
import { mockApp } from '$lib/testing/tauri';

// SvelteKit's router isn't running: navigation is recorded, and the page
// state is what the test sets.
const nav = vi.hoisted(() => ({ goto: vi.fn(), state: {} as Record<string, unknown> }));
vi.mock('$app/navigation', () => ({ goto: nav.goto }));
vi.mock('$app/state', () => ({
  page: {
    get state() {
      return nav.state;
    }
  }
}));

afterEach(() => {
  resetBindings();
  applyTheme(PRESETS[0]);
  nav.state = {};
});

/// jsdom has touch events, so the page takes it for a touch screen. Removed,
/// it's a desktop browser; returns the way back.
function withoutTouch() {
  let owner: object | null = window;
  while (owner && !Object.prototype.hasOwnProperty.call(owner, 'ontouchstart'))
    owner = Object.getPrototypeOf(owner);
  if (!owner) return () => {};
  const descriptor = Object.getOwnPropertyDescriptor(owner, 'ontouchstart')!;
  delete (owner as { ontouchstart?: unknown }).ontouchstart;
  return () => Object.defineProperty(owner, 'ontouchstart', descriptor);
}

const rootColor = (name: string) => document.documentElement.style.getPropertyValue(name);

/// The shortcut button for the action labelled `label`.
const shortcut = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}:`) });

describe('settings on the web', () => {
  let restoreTouch: () => void;
  beforeEach(() => {
    restoreTouch = withoutTouch();
  });
  afterEach(() => restoreTouch());

  it('jumps to the sections this build has', () => {
    render(Settings);
    const jumps = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('#'));
    expect(jumps.map((a) => a.textContent?.trim())).toEqual(['› theme', '› shortcuts']);
    expect(screen.getByRole('link', { name: /how to use/ })).toHaveAttribute('href', '/about');
  });

  describe('back', () => {
    it('goes home when the page was opened directly', async () => {
      const user = userEvent.setup();
      render(Settings);
      await user.click(screen.getByRole('button', { name: /back/ }));
      expect(nav.goto).toHaveBeenCalledWith('/', { replaceState: true });
    });

    it('goes back when the app opened it', async () => {
      const user = userEvent.setup();
      const back = vi.spyOn(history, 'back').mockImplementation(() => {});
      nav.state = { fromApp: true };
      render(Settings);
      await user.click(screen.getByRole('button', { name: /back/ }));
      expect(back).toHaveBeenCalled();
    });
  });

  describe('theme', () => {
    it('applies a preset, and keeps it for next time', async () => {
      const user = userEvent.setup();
      render(Settings);
      await user.click(screen.getByRole('button', { name: /paper/ }));
      expect(rootColor('--color-bg')).toBe('#f4f0e8');
      expect(JSON.parse(localStorage.getItem('kl:theme')!)).toMatchObject({ bg: '#f4f0e8' });
    });

    it('changes one colour', async () => {
      render(Settings);
      const row = screen.getByText('ink').parentElement!;
      // A colour picker can't be typed into; this is the event it fires.
      await fireEvent.input(row.querySelector('input[type="color"]')!, {
        target: { value: '#123456' }
      });
      expect(rootColor('--color-ink')).toBe('#123456');
    });

    it('carries a theme saved before the three-colour palettes over, its border as the ink', () => {
      localStorage.setItem(
        'kl:theme',
        JSON.stringify({ bg: '#000000', fg: '#ffffff', surface: '#000000', border: '#123456' })
      );
      render(Settings);
      const row = screen.getByText('ink').parentElement!;
      expect(row.querySelector('input[type="color"]')).toHaveValue('#123456');
    });

    it('goes back to the default colours', async () => {
      const user = userEvent.setup();
      render(Settings);
      await user.click(screen.getByRole('button', { name: /paper/ }));
      await user.click(screen.getByRole('button', { name: 'reset colours' }));
      expect(rootColor('--color-bg')).toBe('#282c34');
    });
  });

  // What a binding does is checked through resolveKey: the reader goes by it.
  describe('shortcuts', () => {
    it('are left out on a touch screen', () => {
      restoreTouch();
      render(Settings);
      expect(screen.queryByText('KEYBOARD SHORTCUTS')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Shortcuts' })).not.toBeInTheDocument();
    });

    it('lists each action with its keys', () => {
      render(Settings);
      expect(shortcut('Next page')).toHaveAccessibleName('Next page: j, ↓');
      expect(shortcut('Close overlay')).toHaveAccessibleName('Close overlay: Esc');
      expect(shortcut('Next page')).toHaveTextContent('j↓');
      expect(shortcut('Close overlay')).toHaveTextContent('Esc');
    });

    it('rebinds an action to the next key pressed', async () => {
      const user = userEvent.setup();
      render(Settings);
      await user.click(shortcut('Next page'));
      expect(shortcut('Next page')).toHaveTextContent('press a key…');
      expect(shortcut('Next page')).toHaveAccessibleName('Next page: press a key');
      await user.keyboard('x');
      expect(shortcut('Next page')).toHaveTextContent('x');
      expect(resolveKey('x')).toBe('nextPage');
      expect(resolveKey('j')).toBeUndefined();
    });

    it('takes the key from the action that had it', async () => {
      const user = userEvent.setup();
      render(Settings);
      await user.click(shortcut('Next chapter'));
      await user.keyboard('j');
      expect(resolveKey('j')).toBe('nextChapter');
      expect(shortcut('Next page')).toHaveTextContent('↓');
      expect(shortcut('Next page')).not.toHaveTextContent('j');
    });

    it('leaves the binding alone on Escape', async () => {
      const user = userEvent.setup();
      render(Settings);
      await user.click(shortcut('Next page'));
      await user.keyboard('{Escape}');
      expect(shortcut('Next page')).toHaveTextContent('j↓');
      expect(resolveKey('Escape')).toBe('close');
    });

    it('keeps a new binding for next time', async () => {
      const user = userEvent.setup();
      render(Settings);
      await user.click(shortcut('Zoom in'));
      await user.keyboard('+');
      expect(JSON.parse(localStorage.getItem('kl:keybindings')!).zoomIn).toEqual(['+']);
    });

    it('goes back to the default keys', async () => {
      const user = userEvent.setup();
      render(Settings);
      await user.click(shortcut('Next page'));
      await user.keyboard('x');
      await user.click(screen.getByRole('button', { name: 'reset keys' }));
      expect(shortcut('Next page')).toHaveTextContent('j↓');
      expect(resolveKey('j')).toBe('nextPage');
      expect(localStorage.getItem('kl:keybindings')).toBeNull();
    });
  });
});

describe('settings in the app', () => {
  const serverUrlBox = () => screen.getByRole('textbox', { name: 'Server URL' });

  it('jumps to the library, server and diagnostics too', () => {
    mockApp();
    render(Settings);
    const jumps = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('#'));
    expect(jumps.map((a) => a.textContent?.trim())).toEqual([
      '› library',
      '› server',
      '› theme',
      '› diagnostics'
    ]);
  });

  it('shows the account under the server once connected', async () => {
    mockApp();
    localStorage.setItem('kl:serverUrl', 'http://192.168.1.5:3000');
    fakeServer((url) => (url.pathname === '/api/auth/me' ? json({ username: 'ann' }) : undefined));
    render(Settings);
    expect(await screen.findByText('ann')).toBeInTheDocument();
  });

  it('has no account before connecting', async () => {
    mockApp();
    const fetch = fakeServer((url) =>
      url.pathname === '/api/auth/me' ? new Response('', { status: 401 }) : undefined
    );
    render(Settings);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Not logged in.')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('copies the logs', async () => {
    const user = userEvent.setup();
    mockApp((cmd) => {
      if (cmd === 'read_logs') return 'konigslibrary 0.9.0 (linux x86_64)\nsome log';
    });
    render(Settings);
    await user.click(screen.getByRole('button', { name: 'copy logs' }));
    await vi.waitFor(() => expect(getToasts().map((t) => t.label)).toContain('Logs copied'));
    expect(await navigator.clipboard.readText()).toBe(
      'konigslibrary 0.9.0 (linux x86_64)\nsome log'
    );
  });

  it('says when the logs could not be copied', async () => {
    const user = userEvent.setup();
    mockApp((cmd) => {
      if (cmd === 'read_logs') throw 'no log folder';
    });
    render(Settings);
    await user.click(screen.getByRole('button', { name: 'copy logs' }));
    await vi.waitFor(() =>
      expect(getToasts().map((t) => t.label)).toContain('Could not copy the logs')
    );
  });

  it('saves the manga directory, with ~ expanded', async () => {
    const user = userEvent.setup();
    mockApp((cmd, args) => {
      if (cmd === 'expand_home') return (args as { path: string }).path.replace('~', '/home/me');
    });
    render(Settings);
    const box = screen.getByPlaceholderText('/home/user/Manga');
    await user.type(box, ' ~/Manga ');
    await user.click(screen.getAllByRole('button', { name: 'save' })[0]);
    await vi.waitFor(() =>
      expect(localStorage.getItem('kl:nativeMangaDir')).toBe('/home/me/Manga')
    );
    expect(box).toHaveValue('/home/me/Manga');
  });

  it('has no manga directory on Android', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14)');
    mockApp();
    render(Settings);
    expect(screen.queryByPlaceholderText('/home/user/Manga')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Library' })).not.toBeInTheDocument();
    expect(serverUrlBox()).toBeInTheDocument();
  });

  /// A server that's set up, answering only the check made before logging in.
  const setUpServer = () =>
    fakeServer((url) => (url.pathname === '/api/auth/setup' ? json({ needed: false }) : undefined));

  it('connects to a server, then asks to log in', async () => {
    const user = userEvent.setup();
    mockApp();
    const fetch = setUpServer();
    render(Settings);
    await user.type(serverUrlBox(), 'http://192.168.1.5:3000/?key=abc');
    await user.click(screen.getByRole('button', { name: /^connect/ }));
    await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/login'));
    expect(localStorage.getItem('kl:serverUrl')).toBe('http://192.168.1.5:3000');
    expect(getToasts().map((t) => t.label)).toContain('Connected to server');
    expect(fetch).toHaveBeenCalled();
  });

  it('goes straight home when still logged in to that server', async () => {
    const user = userEvent.setup();
    mockApp();
    localStorage.setItem('kl:serverUrl', 'http://192.168.1.5:3000');
    localStorage.setItem('kl:serverToken', 'tok');
    setUpServer();
    render(Settings);
    await user.click(screen.getByRole('button', { name: /^connect/ }));
    await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/'));
    expect(localStorage.getItem('kl:serverToken')).toBe('tok');
  });

  it("drops the old server's session for a new server", async () => {
    const user = userEvent.setup();
    mockApp();
    localStorage.setItem('kl:serverUrl', 'http://192.168.1.5:3000');
    localStorage.setItem('kl:serverToken', 'tok');
    setUpServer();
    render(Settings);
    await user.clear(serverUrlBox());
    await user.type(serverUrlBox(), '192.168.1.6:3000{Enter}');
    await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/login'));
    expect(localStorage.getItem('kl:serverToken')).toBeNull();
  });

  it('says when the address reaches a server, as it is typed', async () => {
    const user = userEvent.setup();
    mockApp();
    setUpServer();
    render(Settings);
    await user.type(serverUrlBox(), '192.168.1.5:3000');
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Server found'), {
      timeout: 2000
    });
    expect(serverUrlBox()).toHaveAttribute('aria-invalid', 'false');
  });

  it('says why a server would not connect', async () => {
    const user = userEvent.setup();
    mockApp();
    // A server from before accounts: the route falls through to its page.
    fakeServer(() => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }));
    render(Settings);
    await user.type(serverUrlBox(), '192.168.1.5:3000{Enter}');
    expect(
      await screen.findByText(
        'Not a konigslibrary server, or an outdated one',
        {},
        { timeout: 2000 }
      )
    ).toBeInTheDocument();
    expect(serverUrlBox()).toHaveAttribute('aria-invalid', 'true');
    expect(nav.goto).not.toHaveBeenCalled();
    expect(localStorage.getItem('kl:serverUrl')).toBeNull();
  });

  // The address is checked as it's typed; this server passes that, then stops.
  it('says why a server that was up would not connect', async () => {
    const user = userEvent.setup();
    mockApp();
    let up = true;
    const fetch = fakeServer(() =>
      up ? json({ needed: false }) : new Response('', { status: 500 })
    );
    render(Settings);
    await user.type(serverUrlBox(), '192.168.1.5:3000');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled(), { timeout: 2000 });
    up = false;
    await user.click(screen.getByRole('button', { name: /^connect/ }));
    expect(
      await screen.findByText('Server responded with 500', {}, { timeout: 2000 })
    ).toBeInTheDocument();
    expect(nav.goto).not.toHaveBeenCalled();
  });

  it('clears the address', async () => {
    const user = userEvent.setup();
    mockApp();
    localStorage.setItem('kl:serverUrl', 'http://192.168.1.5:3000');
    fakeServer(() => json({ entries: [], next: null }));
    render(Settings);
    expect(serverUrlBox()).toHaveValue('http://192.168.1.5:3000');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(serverUrlBox()).toHaveValue('');
    expect(serverUrlBox()).toHaveFocus();
  });
});
