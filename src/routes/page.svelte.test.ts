import { describe, it, expect, vi, beforeAll, onTestFinished } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { initParser } from '$lib/zip';
import Page from './+page.svelte';
import WithReader from '$lib/testing/WithReader.svelte';
import { chapterFile } from '$lib/testing/zip';
import { FakeProvider } from '$lib/testing/reader';
import { fakeServer, json } from '$lib/testing/server';
import { mockApp } from '$lib/testing/tauri';
import type { Reader } from '$lib/context';

// SvelteKit's router isn't running: history entries the page pushes are
// recorded, and the page state stays empty.
const nav = vi.hoisted(() => ({ pushState: vi.fn() }));
vi.mock('$app/navigation', () => ({ pushState: nav.pushState, goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { state: {} } }));

// The parser's Web Worker, run here instead (see upload.svelte.test.ts).
vi.mock('$lib/zip/worker-client', async () => {
  const zip = await import('$lib/zip');
  return {
    chapterEntriesWorker: zip.chapterEntries,
    extractEntryWorker: zip.extractEntry,
    sortChaptersWorker: zip.sortChapters,
    mangaMetaWorker: zip.mangaMeta
  };
});

beforeAll(async () => {
  await initParser(readFileSync('src/lib/zip/wasm/klwasm_bg.wasm'));
});

function renderPage() {
  let reader!: Reader;
  render(WithReader, {
    component: Page,
    onready: (r: Reader) => (reader = r)
  });
  return { reader, user: userEvent.setup() };
}

/// Drops `files` on the page: one archive as a file, several as a folder.
function drop(files: File[], folder = 'Berserk') {
  const entry =
    files.length === 1
      ? { isDirectory: false }
      : {
          isDirectory: true,
          name: folder,
          createReader: () => {
            let batches = [files, []];
            // Called back later, as the browser does, with an empty batch last.
            return {
              readEntries: (ok: (batch: unknown[]) => void) => {
                const [batch, ...rest] = batches;
                batches = rest;
                queueMicrotask(() =>
                  ok(
                    batch.map((f) => ({
                      isFile: true,
                      name: f.name,
                      file: (cb: (f: File) => void) => cb(f)
                    }))
                  )
                );
              }
            };
          }
        };
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { items: [{ webkitGetAsEntry: () => entry }], files }
  });
  document.dispatchEvent(event);
}

/// Opens a three-page chapter dropped on the page, in page-turn mode.
async function readingChapter() {
  localStorage.setItem('kl:scrollMode', 'false');
  const v = renderPage();
  drop([chapterFile('Ch 1.cbz', 3)]);
  await screen.findByRole('region', { name: 'Page 1 of 3' });
  return v;
}

describe('the landing page', () => {
  it('offers to open a manga, and the apps to download', async () => {
    fakeServer(() => new Response('', { status: 503 }));
    renderPage();
    expect(screen.getByRole('heading', { name: 'KONIGSLIBRARY' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Windows' })).toHaveAttribute(
      'href',
      'https://github.com/NasreddinHodja/konigslibrary/releases/latest'
    );
  });

  // The links are fetched once per session, so this one starts a new session.
  it('links straight to the latest release of each app', async () => {
    vi.resetModules();
    const { render, screen, cleanup } = await import('@testing-library/svelte');
    onTestFinished(cleanup);
    const { default: FreshPage } = await import('./+page.svelte');
    const { default: FreshWithReader } = await import('$lib/testing/WithReader.svelte');
    fakeServer((url) =>
      url.pathname.endsWith('/releases/latest')
        ? json({
            tag_name: 'v1.0.0',
            html_url: 'https://github.com/x',
            assets: [
              {
                name: 'konigslibrary_1.0.0_x64-setup.exe',
                browser_download_url: 'https://dl/win.exe'
              },
              {
                name: 'konigslibrary_1.0.0_amd64.AppImage',
                browser_download_url: 'https://dl/linux.AppImage'
              }
            ]
          })
        : undefined
    );
    render(FreshWithReader, { component: FreshPage, onready: () => {} });
    await vi.waitFor(() =>
      expect(screen.getByRole('link', { name: 'Windows' })).toHaveAttribute(
        'href',
        'https://dl/win.exe'
      )
    );
    expect(screen.getByRole('link', { name: 'Linux' })).toHaveAttribute(
      'href',
      'https://dl/linux.AppImage'
    );
    // No APK in the release: the releases page.
    expect(screen.getByRole('link', { name: 'Android' })).toHaveAttribute(
      'href',
      'https://github.com/NasreddinHodja/konigslibrary/releases/latest'
    );
  });
});

describe('dropping', () => {
  it('opens a single chapter straight into the reader', async () => {
    renderPage();
    drop([chapterFile('Ch 1.cbz', 2)]);
    expect(await screen.findByRole('region', { name: 'Manga pages' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Page 1 of 2' })).toBeInTheDocument();
  });

  it("opens a folder at the manga's chapters", async () => {
    renderPage();
    drop([chapterFile('Ch 1.cbz', 2), chapterFile('Ch 2.cbz', 2)]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Berserk' })).toBeInTheDocument();
    expect(screen.getByText('chapters (2)')).toBeInTheDocument();
  });

  it('says why an archive would not open', async () => {
    renderPage();
    drop([new File(['not a zip'], 'Ch 1.cbz')]);
    expect(
      await screen.findByText("Failed to open file: This doesn't look like a valid ZIP/CBZ file.")
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'KONIGSLIBRARY' })).toBeInTheDocument();
  });

  it('ignores a file that is not a manga', async () => {
    renderPage();
    drop([new File(['x'], 'notes.txt')]);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('heading', { name: 'KONIGSLIBRARY' })).toBeInTheDocument();
  });
});

describe('the keyboard', () => {
  it('turns pages', async () => {
    const { user } = await readingChapter();
    await user.keyboard('j');
    expect(screen.getByRole('region', { name: 'Page 2 of 3' })).toBeInTheDocument();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('region', { name: 'Page 1 of 3' })).toBeInTheDocument();
  });

  it('leaves keys alone with a modifier held', async () => {
    const { user } = await readingChapter();
    await user.keyboard('{Control>}j{/Control}');
    expect(screen.getByRole('region', { name: 'Page 1 of 3' })).toBeInTheDocument();
  });

  it('switches to scrolling', async () => {
    const { user } = await readingChapter();
    await user.keyboard('m');
    expect(await screen.findByRole('region', { name: 'Manga pages' })).toBeInTheDocument();
  });

  it('shows the shortcuts, and closes them on Escape without leaving the reader', async () => {
    const { user } = await readingChapter();
    await user.keyboard('?');
    const help = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(help).getByText('Next page')).toBeInTheDocument();
    // While it's open, other keys don't reach the reader.
    await user.keyboard('j');
    expect(screen.getByRole('region', { name: 'Page 1 of 3' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Page 1 of 3' })).toBeInTheDocument();
  });

  it('does nothing with no manga open', async () => {
    const { user } = renderPage();
    await user.keyboard('?');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('goes back on b, the way the browser does', async () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    const { user } = await readingChapter();
    await user.keyboard('b');
    expect(back).toHaveBeenCalledOnce();
  });
});

// Every back is the browser's: the page pushes an entry for an open manga, and
// each pop closes one layer.
describe('back', () => {
  const popState = () => window.dispatchEvent(new PopStateEvent('popstate'));

  it('closes the reader, then the manga', async () => {
    await readingChapter();
    expect(nav.pushState).toHaveBeenCalledWith('', { kl: 'reader' });
    popState();
    expect(await screen.findByRole('heading', { level: 1, name: 'Ch 1' })).toBeInTheDocument();
    popState();
    expect(await screen.findByRole('heading', { name: 'KONIGSLIBRARY' })).toBeInTheDocument();
  });

  it('closes the shortcuts before the reader', async () => {
    const { user } = await readingChapter();
    await user.keyboard('?');
    popState();
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Page 1 of 3' })).toBeInTheDocument();
  });

  it("takes Android's back while a manga is open", async () => {
    const calls = mockApp();
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    const { reader } = renderPage();
    const nativeBack = () => {
      const e = new Event('nativeback', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    // Nothing open: left to the system, which leaves the app.
    expect(nativeBack()).toBe(false);
    await reader.setSource(new FakeProvider([{ name: 'c1', pageCount: 1 }]));
    expect(nativeBack()).toBe(true);
    expect(back).toHaveBeenCalled();
    // The app names its window after the manga, a moment after it opens.
    await vi.waitFor(() => expect(calls.map((c) => c.cmd)).toContain('plugin:window|set_title'));
  });
});
