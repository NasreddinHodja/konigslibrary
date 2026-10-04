import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'svelte';
import PageScrollViewer from './PageScrollViewer.svelte';
import { loadedChapter, mountViewer, pageUrls } from '$lib/testing/reader';
import type { ChapterState } from '$lib/chapter-loader';

// jsdom does no layout, so the viewer's box is faked: 600 wide and 800 tall.
// Until an image loads, a page is guessed at 1.5 times as tall as it is wide,
// 900px, and pages sit 8px apart; so page i starts at 908 * i.
const WIDTH = 600;
const HEIGHT = 800;
const pageTop = (i: number) => 908 * i;
/// The scroll position that centres page i of 900px in the 800px box.
const centred = (i: number) => pageTop(i) + 450 - HEIGHT / 2;

let scrollTop = 0;
let scrollTo: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  scrollTop = 0;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(WIDTH);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(HEIGHT);
  vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(() => scrollTop);
  scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
});

const viewer = () => screen.getByRole('region', { name: 'Manga pages' });

function scrollToY(y: number) {
  scrollTop = y;
  fireEvent.scroll(viewer());
  flushSync();
}

describe('PageScrollViewer', () => {
  it('shows every page in order, then the end of the chapter', async () => {
    await mountViewer(PageScrollViewer, loadedChapter(3));
    const pages = screen.getAllByRole('img');
    expect(pages.map((p) => p.getAttribute('alt'))).toEqual([
      'Page 1 of 3',
      'Page 2 of 3',
      'Page 3 of 3'
    ]);
    expect(pages[1]).toHaveAttribute('src', 'blob:page-1');
    expect(screen.getByText('End of Chapter 1')).toBeInTheDocument();
  });

  it('leaves a page out until its image arrives', async () => {
    const urls = pageUrls(3);
    urls[1] = '';
    await mountViewer(PageScrollViewer, { ...loadedChapter(3), pageUrls: urls });
    expect(screen.queryByAltText('Page 2 of 3')).not.toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByRole('status', { name: 'Loading page 2' })).toBeInTheDocument();
  });

  it('says the chapter is loading', async () => {
    await mountViewer(PageScrollViewer, { ...loadedChapter(0), loading: true });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('shows the load error', async () => {
    const chapter: ChapterState = { ...loadedChapter(0), error: 'bad zip' };
    await mountViewer(PageScrollViewer, chapter);
    expect(screen.getByText('Failed to load chapter: bad zip')).toBeInTheDocument();
  });

  it('opens a chapter scrolled to the page it was left on', async () => {
    let loading = $state(true);
    const chapter: ChapterState = {
      ...loadedChapter(5),
      get loading() {
        return loading;
      }
    };
    const v = await mountViewer(PageScrollViewer, chapter);
    v.reader.state.currentPage = 3;
    loading = false;
    flushSync();
    await vi.waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith({ top: centred(3) }));
  });

  it('scrolls to a page picked from outside', async () => {
    const v = await mountViewer(PageScrollViewer, loadedChapter(5));
    v.reader.goToPage(2, 5);
    flushSync();
    await vi.waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith({ top: centred(2) }));
  });

  // The page under the middle of the box is the reader's current page, which
  // the HUD shows and progress is saved from.
  describe('current page', () => {
    it('follows the scroll', async () => {
      const v = await mountViewer(PageScrollViewer, loadedChapter(5));
      scrollToY(pageTop(2));
      expect(v.reader.state.currentPage).toBe(2);
      scrollToY(pageTop(1) + 100);
      expect(v.reader.state.currentPage).toBe(1);
    });

    it('stays put while the page in the middle has no image yet', async () => {
      const urls = pageUrls(5);
      urls[2] = '';
      const v = await mountViewer(PageScrollViewer, { ...loadedChapter(5), pageUrls: urls });
      scrollToY(pageTop(1));
      scrollToY(pageTop(2));
      expect(v.reader.state.currentPage).toBe(1);
    });

    it('measures pages by their images once they load', async () => {
      const v = await mountViewer(PageScrollViewer, loadedChapter(5));
      // A double spread, half as tall as it is wide: 300px instead of 900.
      const first = screen.getByAltText('Page 1 of 5');
      Object.defineProperties(first, {
        naturalWidth: { value: 2000 },
        naturalHeight: { value: 1000 }
      });
      await fireEvent.load(first);
      // Page 1 is centred now, 250px down, so page 2 ends at 250 + 308 + 908.
      // With the guess it would end at 1816, and this would still be page 2.
      scrollToY(1200);
      expect(v.reader.state.currentPage).toBe(2);
    });
  });

  // ReaderScreen drives the viewer through these for keyboard shortcuts.
  describe('commands', () => {
    it('move a page forward and back, scrolling it into the middle', async () => {
      const v = await mountViewer(PageScrollViewer, loadedChapter(3));
      v.commands.nextPage();
      expect(v.reader.state.currentPage).toBe(1);
      expect(scrollTo).toHaveBeenLastCalledWith({ top: centred(1), behavior: 'smooth' });
      v.commands.prevPage();
      expect(v.reader.state.currentPage).toBe(0);
      expect(scrollTo).toHaveBeenLastCalledWith({ top: centred(0), behavior: 'smooth' });
    });

    it('stop at either end of the chapter', async () => {
      const v = await mountViewer(PageScrollViewer, loadedChapter(2));
      v.commands.prevPage();
      expect(v.reader.state.currentPage).toBe(0);
      v.commands.nextPage();
      v.commands.nextPage();
      expect(v.reader.state.currentPage).toBe(1);
    });
  });

  it('keeps the current page in the middle through a zoom', async () => {
    const setScrollTop = vi.spyOn(Element.prototype, 'scrollTop', 'set');
    const v = await mountViewer(PageScrollViewer, loadedChapter(5));
    v.commands.nextPage();
    v.commands.nextPage();
    v.reader.zoomOut();
    flushSync();
    // At 90% a page is 810px: page 3 starts at 2 * 818 and is centred 5px in.
    await vi.waitFor(() =>
      expect(setScrollTop).toHaveBeenLastCalledWith(2 * 818 + 405 - HEIGHT / 2)
    );
  });

  it('sizes pages by the zoom', async () => {
    const v = await mountViewer(PageScrollViewer, loadedChapter(2));
    v.reader.zoomOut();
    flushSync();
    expect(screen.getByAltText('Page 1 of 2')).toHaveStyle({ width: '90%' });
  });

  describe('tapping', () => {
    it('toggles the menu', async () => {
      const user = userEvent.setup();
      const ontap = vi.fn();
      await mountViewer(PageScrollViewer, loadedChapter(2), { ontap });
      await user.click(viewer());
      expect(ontap).toHaveBeenCalledOnce();
    });

    it('does not count a drag as a tap', async () => {
      const user = userEvent.setup();
      const ontap = vi.fn();
      await mountViewer(PageScrollViewer, loadedChapter(2), { ontap });
      await user.pointer([
        { keys: '[MouseLeft>]', target: viewer(), coords: { clientX: 300, clientY: 300 } },
        { coords: { clientX: 300, clientY: 250 } },
        { keys: '[/MouseLeft]' }
      ]);
      expect(ontap).not.toHaveBeenCalled();
    });
  });
});
