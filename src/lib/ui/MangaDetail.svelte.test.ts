import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import MangaDetail from './MangaDetail.svelte';
import WithReader from '$lib/testing/WithReader.svelte';
import { FakeProvider } from '$lib/testing/reader';
import { fakeServer, json } from '$lib/testing/server';
import { mockApp } from '$lib/testing/tauri';
import { ServerLibraryProvider, type SourceProvider } from '$lib/sources';
import type { Reader } from '$lib/context';
import type { MangaMeta } from '$lib/api/meta';

const chapters = [
  { name: 'chapter_0001-00', pageCount: 20 },
  { name: 'chapter_0002-00', pageCount: 18 },
  { name: 'chapter_0012-05', pageCount: 22 }
];

function meta(overrides: Partial<MangaMeta> = {}): MangaMeta {
  return {
    title: 'Berserk',
    description: null,
    year: 1989,
    authors: ['Kentaro Miura'],
    tags: ['Action', 'Dark Fantasy', 'Horror', 'Seinen', 'Tragedy', 'Drama', 'Military'],
    status: 'Ongoing',
    coverUrl: 'blob:cover',
    ...overrides
  };
}

/// MangaDetail for the manga `provider` opens, once its metadata has loaded.
async function renderDetail(
  provider: SourceProvider = new FakeProvider(chapters, 'berserk', meta())
) {
  let reader!: Reader;
  render(WithReader, {
    component: MangaDetail,
    onready: (r: Reader) => (reader = r)
  });
  await reader.setSource(provider);
  await vi.waitFor(() => expect(reader.metaState).not.toBe('loading'));
  return { reader, user: userEvent.setup() };
}

const saveProgress = (chapter: string, page: number) =>
  localStorage.setItem('kl:progress:berserk', JSON.stringify({ chapter, page }));

/// The chapter tiles in order, by the chapter each names.
const tileNumbers = () =>
  screen
    .getAllByRole('button', { name: / — \d+ pages/ })
    .map((t) => t.getAttribute('aria-label')!.split(' — ')[0]);

describe('MangaDetail', () => {
  describe('metadata', () => {
    it('shows the title, cover and details', async () => {
      await renderDetail();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Berserk');
      expect(screen.getByRole('img', { name: 'Berserk' })).toHaveAttribute('src', 'blob:cover');
      expect(screen.getByText('Ongoing')).toBeInTheDocument();
      expect(screen.getByText('Kentaro Miura')).toBeInTheDocument();
      expect(screen.getByText('1989')).toBeInTheDocument();
      expect(screen.getByText('berserk')).toBeInTheDocument();
    });

    it('shows four tags, and up to six more on request', async () => {
      const { user } = await renderDetail();
      expect(screen.getByText('Seinen')).toBeInTheDocument();
      expect(screen.queryByText('Tragedy')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'more' }));
      expect(screen.getByText('Drama')).toBeInTheDocument();
      expect(screen.queryByText('Military')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'less' }));
      await vi.waitFor(() => expect(screen.queryByText('Drama')).not.toBeInTheDocument());
    });

    it('offers no more for four tags or fewer', async () => {
      await renderDetail(new FakeProvider(chapters, 'berserk', meta({ tags: ['A', 'B'] })));
      expect(screen.queryByRole('button', { name: 'more' })).not.toBeInTheDocument();
    });

    it('falls back to the folder name and a placeholder cover', async () => {
      await renderDetail(
        new FakeProvider(chapters, 'berserk', meta({ title: null, coverUrl: null }))
      );
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('berserk');
      expect(screen.queryByRole('img', { name: /berserk/i })).not.toBeInTheDocument();
    });

    it('drops a cover that fails to load', async () => {
      await renderDetail();
      screen.getByRole('img', { name: 'Berserk' }).dispatchEvent(new Event('error'));
      await vi.waitFor(() =>
        expect(screen.queryByRole('img', { name: 'Berserk' })).not.toBeInTheDocument()
      );
    });

    it('leaves the details out for a manga without metadata', async () => {
      await renderDetail(new FakeProvider(chapters, 'berserk'));
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('berserk');
      expect(screen.queryByText('AUTHOR')).not.toBeInTheDocument();
    });
  });

  describe('chapters', () => {
    it('lists them oldest first, with how many there are', async () => {
      await renderDetail();
      expect(screen.getByText('CHAPTERS (3)')).toBeInTheDocument();
      expect(tileNumbers()).toEqual(['Ch. 1', 'Ch. 2', 'Ch. 12.5']);
    });

    it('turns the order around, and keeps it for next time', async () => {
      const { user } = await renderDetail();
      await user.click(screen.getByRole('button', { name: 'Sort newest first' }));
      expect(tileNumbers()).toEqual(['Ch. 12.5', 'Ch. 2', 'Ch. 1']);
      expect(screen.getByRole('button', { name: 'Sort oldest first' })).toBeInTheDocument();
      expect(localStorage.getItem('kl:chapterSort')).toBe('desc');
    });

    it('starts newest first when that was picked last time', async () => {
      localStorage.setItem('kl:chapterSort', 'desc');
      await renderDetail();
      expect(tileNumbers()).toEqual(['Ch. 12.5', 'Ch. 2', 'Ch. 1']);
    });

    it('finds a chapter by its number', async () => {
      const { user } = await renderDetail();
      await user.type(screen.getByRole('textbox', { name: 'Search chapters…' }), '12.5');
      expect(tileNumbers()).toEqual(['Ch. 12.5']);
    });

    it('says when a search finds no chapter', async () => {
      const { user } = await renderDetail();
      await user.type(screen.getByRole('textbox', { name: 'Search chapters…' }), '99');
      expect(screen.getByText('No chapters match "99"')).toBeInTheDocument();
    });

    // Opening a chapter is ReaderScreen's job, from the reader's state.
    it('opens a chapter at its first page', async () => {
      const { reader, user } = await renderDetail();
      await user.click(screen.getByRole('button', { name: 'Ch. 2 — 18 pages' }));
      expect(reader.state.selectedChapter).toBe('chapter_0002-00');
      expect(reader.state.currentPage).toBe(0);
    });

    it('opens the chapter last read where it was left', async () => {
      saveProgress('chapter_0002-00', 4);
      const { reader, user } = await renderDetail();
      await user.click(screen.getByRole('button', { name: 'Ch. 2 — 18 pages — resume at p.5' }));
      expect(reader.state.selectedChapter).toBe('chapter_0002-00');
      expect(reader.state.currentPage).toBe(4);
    });
  });

  describe('resume', () => {
    it('picks up where the manga was left', async () => {
      saveProgress('chapter_0012-05', 9);
      const { reader, user } = await renderDetail();
      await user.click(screen.getByRole('button', { name: 'RESUME: Ch. 12.5, p.10' }));
      expect(reader.state.selectedChapter).toBe('chapter_0012-05');
      expect(reader.state.currentPage).toBe(9);
    });

    it('is offered without metadata too', async () => {
      saveProgress('chapter_0001-00', 0);
      await renderDetail(new FakeProvider(chapters, 'berserk'));
      expect(screen.getByRole('button', { name: 'RESUME: Ch. 1, p.1' })).toBeInTheDocument();
    });

    it('is not offered for a manga not started', async () => {
      await renderDetail();
      expect(screen.queryByRole('button', { name: /^RESUME/ })).not.toBeInTheDocument();
    });
  });

  describe('download', () => {
    /// A server manga opened in the app, `downloaded` or not.
    async function serverManga(downloaded: boolean) {
      fakeServer((url) => {
        if (url.pathname === '/api/library/berserk/chapters')
          return json([{ name: 'ch1', slug: 'ch1.cbz', pageCount: 1, pages: ['1.jpg'] }]);
        if (url.pathname === '/api/library/berserk/meta') return json({ ...meta(), cover: null });
      });
      const calls = mockApp((cmd) => {
        if (cmd === 'list_offline_manga')
          return downloaded ? [{ slug: 'berserk', name: 'berserk', path: '/dl/berserk' }] : [];
        if (cmd === 'download_file') return new Promise(() => {});
      });
      const v = await renderDetail(new ServerLibraryProvider('berserk', 'berserk'));
      return { ...v, calls };
    }

    it('downloads a server manga after asking', async () => {
      const { user, calls } = await serverManga(false);
      await user.click(await screen.findByRole('button', { name: 'DOWNLOAD' }));
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent('Download "Berserk"?');
      await user.click(within(dialog).getByRole('button', { name: 'Download' }));
      // Gone while it runs: the toast shows its progress.
      expect(screen.queryByRole('button', { name: 'DOWNLOAD' })).not.toBeInTheDocument();
      await vi.waitFor(() =>
        expect(calls).toContainEqual(
          expect.objectContaining({
            cmd: 'download_file',
            args: expect.objectContaining({ slug: 'berserk', fileName: 'ch1.cbz' })
          })
        )
      );
    });

    it('is not offered for a manga already downloaded', async () => {
      const { calls } = await serverManga(true);
      await vi.waitFor(() => expect(calls.map((c) => c.cmd)).toContain('list_offline_manga'));
      expect(screen.queryByRole('button', { name: 'DOWNLOAD' })).not.toBeInTheDocument();
    });

    it('is not offered on the web', async () => {
      fakeServer((url) => {
        if (url.pathname === '/api/library/berserk/chapters') return json([]);
      });
      await renderDetail(new ServerLibraryProvider('berserk', 'berserk'));
      expect(screen.queryByRole('button', { name: 'DOWNLOAD' })).not.toBeInTheDocument();
    });
  });
});
