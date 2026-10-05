import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, onTestFinished } from 'vitest';
import { mockIPC } from '@tauri-apps/api/mocks';
import type { InvokeArgs } from '@tauri-apps/api/core';
import type { Reader } from '$lib/context';
import type { LibraryEntry } from '$lib/utils/types';
import { fakeServer, json, serverDown } from '$lib/testing/server';
import { scrollIntoReach } from '$lib/testing/intersection';

// The library keeps module state (server status, downloads, known covers), so
// every test loads it afresh, Testing Library included so they share Svelte.
beforeAll(async () => {
  // Compiles everything once, so the first test isn't left waiting on it.
  await import('./MangaLibrary.svelte');
}, 30_000);

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderLibrary() {
  // One at a time: the reader's modules import each other in a cycle.
  const { render, screen, within, cleanup } = await import('@testing-library/svelte');
  // The setup file's cleanup belongs to the copy loaded before the reset.
  onTestFinished(cleanup);
  const { default: userEvent } = await import('@testing-library/user-event');
  const harness = await import('$lib/testing/WithReader.svelte');
  const lib = await import('./MangaLibrary.svelte');
  const toasts = await import('$lib/ui/toast.svelte');
  let reader!: Reader;
  const { unmount } = render(harness.default, {
    component: lib.default,
    onready: (r: Reader) => (reader = r)
  });
  /// The tab on screen. The other is rendered too, for swiping, but inert,
  /// which neither jsdom nor Testing Library hide it by.
  const shown = () =>
    within(document.querySelector<HTMLElement>('[data-scroll-root]:not([inert])')!);
  return { screen, shown, user: userEvent.setup(), reader, toasts, unmount };
}

const SERVER = 'http://server.test';
const useServer = () => localStorage.setItem('kl:serverUrl', SERVER);

function entry(name: string, title: string | null = null): LibraryEntry {
  return { name, slug: name, title, cover: null, coverVersion: null, scanned: true };
}

/// A server whose library is `pages`, one after another, each answered for
/// the `after` cursor of the one before it; `q` filters by name. `other`
/// answers anything else first.
function library(pages: LibraryEntry[][], other?: (url: URL) => Response | undefined) {
  return fakeServer((url) => {
    const answer = other?.(url);
    if (answer) return answer;
    if (url.pathname === '/api/ping') return new Response('ok');
    if (url.pathname === '/api/library') {
      const i = Number(url.searchParams.get('after') ?? 0);
      const q = url.searchParams.get('q') ?? '';
      const entries = (pages[i] ?? []).filter((e) => e.name.includes(q));
      return json({ entries, next: i + 1 < pages.length ? String(i + 1) : null });
    }
    const chapters = url.pathname.match(/^\/api\/library\/([^/]+)\/chapters$/);
    if (chapters) return json([{ name: 'ch1', slug: 'ch1.cbz', pageCount: 1, pages: ['1.jpg'] }]);
  });
}

const libraryRequests = (fetch: ReturnType<typeof library>) =>
  fetch.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((u) => u.pathname === '/api/library');

describe('MangaLibrary on the web', () => {
  it('asks for a source when there is none', async () => {
    const { screen } = await renderLibrary();
    expect(screen.getByText('No manga sources configured')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set one up in Settings' })).toHaveAttribute(
      'href',
      '/settings'
    );
  });

  it("lists the server's manga by their titles", async () => {
    useServer();
    library([[entry('berserk', 'Berserk'), entry('vagabond')]]);
    const { shown } = await renderLibrary();
    expect(await shown().findByRole('button', { name: 'Open Berserk' })).toBeInTheDocument();
    // No title in its metadata: the folder name.
    expect(shown().getByRole('button', { name: 'Open vagabond' })).toBeInTheDocument();
  });

  it('reads the metadata of a manga the server has not scanned, once it is near', async () => {
    useServer();
    const meta = vi.fn(() => json({ title: 'Real Title', cover: null }));
    library([[{ name: 'some-folder', slug: 'some-folder' }]], (url) =>
      url.pathname === '/api/library/some-folder/meta' ? meta() : undefined
    );
    const { shown } = await renderLibrary();
    expect(await shown().findByRole('button', { name: 'Open some-folder' })).toBeInTheDocument();
    expect(meta).not.toHaveBeenCalled();
    scrollIntoReach();
    expect(await shown().findByRole('button', { name: 'Open Real Title' })).toBeInTheDocument();
  });

  it('loads the next page as the end of the list comes near', async () => {
    useServer();
    const fetch = library([[entry('a', 'Alpha')], [entry('b', 'Beta')]]);
    const { shown } = await renderLibrary();
    await shown().findByRole('button', { name: 'Open Alpha' });
    expect(shown().queryByRole('button', { name: 'Open Beta' })).not.toBeInTheDocument();
    scrollIntoReach();
    expect(await shown().findByRole('button', { name: 'Open Beta' })).toBeInTheDocument();
    expect(libraryRequests(fetch).map((u) => u.searchParams.get('after'))).toEqual([null, '1']);
    expect(shown().getByRole('button', { name: 'Open Alpha' })).toBeInTheDocument();
  });

  it('searches the server', async () => {
    useServer();
    library([[entry('berserk', 'Berserk'), entry('vagabond', 'Vagabond')]]);
    const { screen, shown, user } = await renderLibrary();
    await shown().findByRole('button', { name: 'Open Vagabond' });
    await user.type(screen.getByRole('textbox', { name: 'Search library' }), 'ber');
    await vi.waitFor(() =>
      expect(shown().queryByRole('button', { name: 'Open Vagabond' })).not.toBeInTheDocument()
    );
    expect(shown().getByRole('button', { name: 'Open Berserk' })).toBeInTheDocument();
  });

  it('says when a search finds nothing', async () => {
    useServer();
    library([[entry('berserk', 'Berserk')]]);
    const { screen, shown, user } = await renderLibrary();
    await shown().findByRole('button', { name: 'Open Berserk' });
    await user.type(screen.getByRole('textbox', { name: 'Search library' }), 'zzz');
    expect(await screen.findByText('No results for "zzz"')).toBeInTheDocument();
  });

  it('says when the server has no manga', async () => {
    useServer();
    library([[]]);
    const { screen } = await renderLibrary();
    expect(await screen.findByText('No manga found')).toBeInTheDocument();
  });

  it('says when the server is unreachable', async () => {
    useServer();
    serverDown();
    const { screen } = await renderLibrary();
    expect(await screen.findByText('Server unreachable')).toBeInTheDocument();
    expect(screen.getByText('offline')).toBeInTheDocument();
  });

  it('opens a manga', async () => {
    useServer();
    library([[entry('berserk', 'Berserk')]]);
    const { shown, user, reader } = await renderLibrary();
    await user.click(await shown().findByRole('button', { name: 'Open Berserk' }));
    await vi.waitFor(() => expect(reader.chapters).toEqual([{ name: 'ch1', pageCount: 1 }]));
    expect(reader.provider?.mangaName).toBe('berserk');
  });

  it('reports a manga that fails to open', async () => {
    useServer();
    library([[entry('huge', 'Huge')]], (url) =>
      url.pathname === '/api/library/huge/chapters'
        ? new Response('6000 chapter archives', { status: 422 })
        : undefined
    );
    const { shown, user, reader, toasts } = await renderLibrary();
    await user.click(await shown().findByRole('button', { name: 'Open Huge' }));
    await vi.waitFor(() =>
      expect(toasts.getToasts().map((t) => t.label)).toContainEqual(
        expect.stringContaining('6000 chapter archives')
      )
    );
    expect(reader.provider).toBeNull();
  });

  it('refreshes the list from the server', async () => {
    useServer();
    let titles = ['Old'];
    fakeServer((url) => {
      if (url.pathname === '/api/ping') return new Response('ok');
      if (url.pathname === '/api/library')
        return json({ entries: titles.map((t) => entry(t.toLowerCase(), t)), next: null });
    });
    const { screen, shown, user } = await renderLibrary();
    await shown().findByRole('button', { name: 'Open Old' });
    titles = ['New'];
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await shown().findByRole('button', { name: 'Open New' })).toBeInTheDocument();
    expect(shown().queryByRole('button', { name: 'Open Old' })).not.toBeInTheDocument();
  });

  it('offers no download or selection without the app', async () => {
    useServer();
    library([[entry('berserk', 'Berserk')]]);
    const { screen, shown } = await renderLibrary();
    await shown().findByRole('button', { name: 'Open Berserk' });
    expect(screen.queryByRole('button', { name: /^Download/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument();
  });
});

describe('MangaLibrary in the app', () => {
  type Device = { name: string; path: string; origin: string; slug: string | null };

  /// Tauri's side: `device` is the Device tab's one page, `downloaded` the
  /// finished downloads. Every call is recorded.
  function app({
    device = [] as Device[],
    downloaded = [] as { slug: string; name: string; path: string }[],
    titles = {} as Record<string, string>,
    deviceFails = false
  } = {}) {
    localStorage.setItem('kl:nativeMangaDir', '/manga');
    const calls: { cmd: string; args?: InvokeArgs }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      switch (cmd) {
        case 'list_device_manga':
          if (deviceFails) throw new Error('EACCES');
          return { entries: device, next: null };
        case 'list_offline_manga':
          return downloaded;
        // A manga on the device has its title read from its own files.
        case 'read_manga_meta': {
          const title = titles[(args as { path: string }).path];
          if (!title) throw new Error('no meta');
          return { title, cover: null };
        }
        // A download that is still copying, for as long as the test runs.
        case 'download_file':
          return new Promise(() => {});
      }
    });
    return calls;
  }

  const tab = (screen: Awaited<ReturnType<typeof renderLibrary>>['screen'], name: string) =>
    screen.getByRole('tab', { name: new RegExp(`^${name}`) });

  it('lists the manga on this device and on the server, under their own tabs', async () => {
    useServer();
    library([[entry('vagabond', 'Vagabond')]]);
    app({ device: [{ name: 'Monster', path: '/manga/Monster', origin: 'folder', slug: null }] });
    const { screen, shown, user } = await renderLibrary();
    expect(await shown().findByRole('button', { name: 'Open Monster' })).toBeInTheDocument();
    expect(tab(screen, 'device')).toHaveAttribute('aria-selected', 'true');
    await user.click(tab(screen, 'server'));
    expect(tab(screen, 'server')).toHaveAttribute('aria-selected', 'true');
    expect(await shown().findByRole('button', { name: 'Open Vagabond' })).toBeInTheDocument();
  });

  it('opens on the tab picked last time', async () => {
    useServer();
    library([[]]);
    app();
    const first = await renderLibrary();
    await first.user.click(tab(first.screen, 'server'));
    first.unmount();
    const { screen } = await renderLibrary();
    expect(tab(screen, 'server')).toHaveAttribute('aria-selected', 'true');
  });

  it('says when the manga directory cannot be read', async () => {
    app({ deviceFails: true });
    const { screen } = await renderLibrary();
    expect(await screen.findByText('Could not read manga directory: /manga')).toBeInTheDocument();
  });

  it('downloads a server manga after asking', async () => {
    useServer();
    library([[entry('berserk', 'Berserk')]]);
    const calls = app();
    localStorage.setItem('kl:libraryTab', 'server');
    const { screen, shown, user } = await renderLibrary();
    await user.click(await shown().findByRole('button', { name: 'Download Berserk' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Download "Berserk"?');
    await user.click(screen.getByRole('button', { name: 'download' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // While it copies, the card's button cancels it.
    expect(
      await shown().findByRole('button', { name: 'Cancel download of Berserk' })
    ).toBeInTheDocument();
    expect(
      calls.some(
        (c) => c.cmd === 'download_file' && (c.args as { slug?: string })?.slug === 'berserk'
      )
    ).toBe(true);
  });

  it('does not download when the question is cancelled', async () => {
    useServer();
    library([[entry('berserk', 'Berserk')]]);
    const calls = app();
    localStorage.setItem('kl:libraryTab', 'server');
    const { screen, shown, user } = await renderLibrary();
    await user.click(await shown().findByRole('button', { name: 'Download Berserk' }));
    await user.click(screen.getByRole('button', { name: 'cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.some((c) => c.cmd === 'download_file')).toBe(false);
  });

  it('marks a downloaded manga and deletes it after asking', async () => {
    useServer();
    library([[entry('berserk', 'Berserk')]]);
    const calls = app({
      downloaded: [{ slug: 'berserk', name: 'berserk', path: '/dl/berserk' }],
      titles: { '/dl/berserk': 'Berserk' }
    });
    localStorage.setItem('kl:libraryTab', 'server');
    const { screen, shown, user } = await renderLibrary();
    await shown().findByRole('button', { name: 'Delete berserk' });
    scrollIntoReach();
    await user.click(await shown().findByRole('button', { name: 'Delete Berserk' }));
    expect(shown().getByTitle('Downloaded')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete "Berserk"?');
    await user.click(screen.getByRole('button', { name: 'delete' }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          cmd: 'delete_offline_manga',
          args: expect.objectContaining({ slug: 'berserk' })
        })
      )
    );
  });

  it('deletes an uploaded manga by its folder', async () => {
    const calls = app({
      device: [{ name: 'Pluto', path: '/imports/Pluto', origin: 'import', slug: null }]
    });
    const { screen, shown, user } = await renderLibrary();
    await user.click(await shown().findByRole('button', { name: 'Delete Pluto' }));
    await user.click(screen.getByRole('button', { name: 'delete' }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          cmd: 'delete_imported_manga',
          args: expect.objectContaining({ name: 'Pluto' })
        })
      )
    );
  });

  it('offers no download for a manga in the manga directory', async () => {
    app({ device: [{ name: 'Monster', path: '/manga/Monster', origin: 'folder', slug: null }] });
    const { shown } = await renderLibrary();
    await shown().findByRole('button', { name: 'Open Monster' });
    expect(shown().queryByRole('button', { name: 'Download Monster' })).not.toBeInTheDocument();
    expect(shown().queryByRole('button', { name: 'Delete Monster' })).not.toBeInTheDocument();
  });

  // Its finished downloads may not be listed yet when the Device tab is.
  it('offers no download for a manga already on this device', async () => {
    app({
      device: [{ name: 'berserk', path: '/dl/berserk', origin: 'download', slug: 'berserk' }],
      titles: { '/dl/berserk': 'Berserk' }
    });
    const { shown } = await renderLibrary();
    await shown().findByRole('button', { name: 'Open berserk' });
    expect(shown().queryByRole('button', { name: /^Download/ })).not.toBeInTheDocument();
  });

  describe('selecting', () => {
    async function selectingOnServer() {
      useServer();
      library([[entry('a', 'Alpha'), entry('b', 'Beta'), entry('c', 'Gamma')]]);
      app({ downloaded: [{ slug: 'c', name: 'c', path: '/dl/c' }], titles: { '/dl/c': 'Gamma' } });
      localStorage.setItem('kl:libraryTab', 'server');
      const v = await renderLibrary();
      await v.shown().findByRole('button', { name: 'Open Alpha' });
      scrollIntoReach();
      await v.shown().findByRole('button', { name: 'Open Gamma' });
      await v.user.click(v.screen.getByRole('button', { name: 'Select' }));
      return v;
    }

    it('picks manga by tapping them, and downloads them together', async () => {
      const { screen, shown, user } = await selectingOnServer();
      expect(screen.getByText('0 selected')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'download' })).toBeDisabled();
      await user.click(shown().getByRole('button', { name: 'Open Alpha' }));
      await user.click(shown().getByRole('button', { name: 'Open Beta' }));
      expect(screen.getByText('2 selected')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'download' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('Download 2 manga?');
    });

    it('unpicks a manga tapped again', async () => {
      const { screen, shown, user } = await selectingOnServer();
      await user.click(shown().getByRole('button', { name: 'Open Alpha' }));
      await user.click(shown().getByRole('button', { name: 'Open Alpha' }));
      expect(screen.getByText('0 selected')).toBeInTheDocument();
    });

    it('leaves out a manga already downloaded', async () => {
      const { screen, shown, user } = await selectingOnServer();
      await user.click(screen.getByRole('button', { name: 'all' }));
      expect(screen.getByText('2 selected')).toBeInTheDocument();
      await user.click(shown().getByRole('button', { name: 'Open Gamma' }));
      expect(screen.getByText('2 selected')).toBeInTheDocument();
    });

    it('opens nothing while selecting', async () => {
      const { shown, user, reader } = await selectingOnServer();
      await user.click(shown().getByRole('button', { name: 'Open Alpha' }));
      expect(reader.provider).toBeNull();
    });

    it('ends on cancel', async () => {
      const { screen, shown, user } = await selectingOnServer();
      await user.click(shown().getByRole('button', { name: 'Open Alpha' }));
      await user.click(screen.getByRole('button', { name: 'Cancel selection' }));
      expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'library' })).toBeInTheDocument();
    });
  });
});
