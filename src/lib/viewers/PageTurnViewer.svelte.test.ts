import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'svelte';
import PageTurnViewer from './PageTurnViewer.svelte';
import { loadedChapter, mountViewer } from '$lib/testing/reader';
import { swipe, tap } from '$lib/testing/touch';
import type { ChapterState } from '$lib/chapter-loader';

const W = 1000;

// jsdom does no layout; the viewer measures its width for swipes and tap zones.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(W);
});

const twoChapters = [
  { name: 'chapter_0001-00', pageCount: 3 },
  { name: 'chapter_0002-00', pageCount: 3 }
];

const viewer = () => screen.getByRole('region');
const zone = (name: string) => screen.getByRole('button', { name });

describe('PageTurnViewer', () => {
  it('shows the current page and only exposes that one', async () => {
    const v = await mountViewer(PageTurnViewer, loadedChapter(5));
    v.reader.state.currentPage = 2;
    flushSync();
    expect(viewer()).toHaveAccessibleName('Page 3 of 5');
    // The pages either side are rendered for the slide but hidden from
    // assistive tech, so this finds exactly one.
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:page-2');
  });

  it('says the chapter is loading', async () => {
    await mountViewer(PageTurnViewer, { ...loadedChapter(0), loading: true });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('shows the load error', async () => {
    const chapter: ChapterState = { ...loadedChapter(0), error: 'bad zip' };
    await mountViewer(PageTurnViewer, chapter);
    expect(screen.getByText('Failed to load chapter: bad zip')).toBeInTheDocument();
  });

  // ReaderScreen drives the viewer through these for keyboard shortcuts.
  describe('commands', () => {
    it('turn pages forward and back', async () => {
      const v = await mountViewer(PageTurnViewer, loadedChapter(3));
      v.commands.nextPage();
      flushSync();
      expect(viewer()).toHaveAccessibleName('Page 2 of 3');
      v.commands.prevPage();
      flushSync();
      expect(viewer()).toHaveAccessibleName('Page 1 of 3');
    });

    it('go from the last page to the end screen and back', async () => {
      const v = await mountViewer(PageTurnViewer, loadedChapter(2), { chapters: twoChapters });
      v.commands.nextPage();
      v.commands.nextPage();
      flushSync();
      expect(viewer()).toHaveAccessibleName('End of chapter');
      expect(screen.getByText('End of Ch. 1')).toBeInTheDocument();
      v.commands.prevPage();
      flushSync();
      expect(viewer()).toHaveAccessibleName('Page 2 of 2');
    });

    it('stop before the first page of the first chapter', async () => {
      const v = await mountViewer(PageTurnViewer, loadedChapter(3));
      v.commands.prevPage();
      flushSync();
      expect(viewer()).toHaveAccessibleName('Page 1 of 3');
    });

    it('stop on the end screen of the last chapter', async () => {
      const v = await mountViewer(PageTurnViewer, loadedChapter(1));
      v.commands.nextPage();
      v.commands.nextPage();
      flushSync();
      expect(viewer()).toHaveAccessibleName('End of chapter');
      expect(screen.getByText('No next chapter')).toBeInTheDocument();
    });

    // Changing chapter is the reader's job: the viewer asks for it, and
    // ReaderScreen loads the new pages. So these check what was asked for.
    it('open the next chapter once the slide past the end screen finishes', async () => {
      const v = await mountViewer(PageTurnViewer, loadedChapter(1), { chapters: twoChapters });
      v.commands.nextPage();
      flushSync();
      v.commands.nextPage();
      // Not at once: the next chapter's loader would cut in mid-slide.
      expect(v.reader.state.selectedChapter).toBe('chapter_0001-00');
      await vi.waitFor(() => expect(v.reader.state.selectedChapter).toBe('chapter_0002-00'));
    });

    it('go back to the end screen of the previous chapter', async () => {
      const v = await mountViewer(PageTurnViewer, loadedChapter(3), {
        chapters: twoChapters,
        open: 'chapter_0002-00'
      });
      v.commands.prevPage();
      await vi.waitFor(() => expect(v.reader.state.selectedChapter).toBe('chapter_0001-00'));
      expect(viewer()).toHaveAccessibleName('End of chapter');
    });

    it('zoom the current page while held', async () => {
      const v = await mountViewer(PageTurnViewer, loadedChapter(3));
      v.commands.holdZoom!(true);
      flushSync();
      // The only trace of the zoom jsdom can show: no layout, no paint.
      expect(screen.getByRole('img').parentElement).toHaveStyle({ transform: 'scale(2)' });
      v.commands.holdZoom!(false);
      flushSync();
      expect(screen.getByRole('img').parentElement).not.toHaveStyle({ transform: 'scale(2)' });
    });
  });

  describe('click zones', () => {
    it('turn on a mouse click on either side', async () => {
      const user = userEvent.setup();
      await mountViewer(PageTurnViewer, loadedChapter(3));
      await user.click(zone('Next page'));
      expect(viewer()).toHaveAccessibleName('Page 2 of 3');
      await user.click(zone('Previous page'));
      expect(viewer()).toHaveAccessibleName('Page 1 of 3');
    });

    it('turn on Enter and on Space', async () => {
      const user = userEvent.setup();
      await mountViewer(PageTurnViewer, loadedChapter(3));
      zone('Next page').focus();
      await user.keyboard('{Enter}');
      expect(viewer()).toHaveAccessibleName('Page 2 of 3');
      await user.keyboard(' ');
      expect(viewer()).toHaveAccessibleName('Page 3 of 3');
    });

    it('toggle the menu from the middle', async () => {
      const user = userEvent.setup();
      const ontap = vi.fn();
      await mountViewer(PageTurnViewer, loadedChapter(3), { ontap });
      await user.click(zone('Toggle menu'));
      expect(ontap).toHaveBeenCalledOnce();
      expect(viewer()).toHaveAccessibleName('Page 1 of 3');
    });

    it('swap sides for right-to-left reading', async () => {
      const user = userEvent.setup();
      const v = await mountViewer(PageTurnViewer, loadedChapter(3));
      v.reader.state.rtl = true;
      flushSync();
      // The labels stay put; the left side now goes forward.
      await user.click(zone('Previous page'));
      expect(viewer()).toHaveAccessibleName('Page 2 of 3');
    });

    it('do nothing while the zoom is held', async () => {
      const user = userEvent.setup();
      const ontap = vi.fn();
      const v = await mountViewer(PageTurnViewer, loadedChapter(3), { ontap });
      v.commands.holdZoom!(true);
      flushSync();
      await user.click(zone('Next page'));
      await user.click(zone('Toggle menu'));
      expect(viewer()).toHaveAccessibleName('Page 1 of 3');
      expect(ontap).not.toHaveBeenCalled();
    });

    it('turn once for a tap, which sends both touch and pointer events', async () => {
      await mountViewer(PageTurnViewer, loadedChapter(3));
      const right = zone('Next page');
      tap(right, { x: W - 20, y: 300 });
      await fireEvent.pointerUp(right, { pointerType: 'touch' });
      expect(viewer()).toHaveAccessibleName('Page 2 of 3');
    });

    it('step aside on the end screen so its button can be pressed', async () => {
      const user = userEvent.setup();
      const v = await mountViewer(PageTurnViewer, loadedChapter(1), { chapters: twoChapters });
      v.commands.nextPage();
      flushSync();
      expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Ch. 2' }));
      expect(v.reader.state.selectedChapter).toBe('chapter_0002-00');
    });
  });

  describe('touch', () => {
    it('toggles the menu on a tap in the middle', async () => {
      const ontap = vi.fn();
      await mountViewer(PageTurnViewer, loadedChapter(3), { ontap });
      tap(viewer(), { x: W / 2, y: 300 });
      expect(ontap).toHaveBeenCalledOnce();
      expect(viewer()).toHaveAccessibleName('Page 1 of 3');
    });

    // Short enough that only its speed can turn the page, not its distance.
    it('turns on a short, fast flick either way', async () => {
      await mountViewer(PageTurnViewer, loadedChapter(3));
      swipe(viewer(), { x: 500, y: 300 }, { x: 460, y: 300 });
      expect(viewer()).toHaveAccessibleName('Page 2 of 3');
      swipe(viewer(), { x: 460, y: 300 }, { x: 500, y: 300 });
      expect(viewer()).toHaveAccessibleName('Page 1 of 3');
    });

    it('turns on a slow drag past half the width', async () => {
      await mountViewer(PageTurnViewer, loadedChapter(3));
      swipe(viewer(), { x: 900, y: 300 }, { x: 300, y: 300 }, 2000);
      expect(viewer()).toHaveAccessibleName('Page 2 of 3');
    });

    it('stays on the page after a slow, short drag', async () => {
      await mountViewer(PageTurnViewer, loadedChapter(3));
      swipe(viewer(), { x: 600, y: 300 }, { x: 450, y: 300 }, 2000);
      expect(viewer()).toHaveAccessibleName('Page 1 of 3');
    });

    it('ignores a mostly vertical swipe', async () => {
      await mountViewer(PageTurnViewer, loadedChapter(3));
      swipe(viewer(), { x: 600, y: 100 }, { x: 500, y: 500 });
      expect(viewer()).toHaveAccessibleName('Page 1 of 3');
    });

    it('reverses the flick for right-to-left reading', async () => {
      const v = await mountViewer(PageTurnViewer, loadedChapter(3));
      v.reader.state.rtl = true;
      flushSync();
      swipe(viewer(), { x: 400, y: 300 }, { x: 600, y: 300 });
      expect(viewer()).toHaveAccessibleName('Page 2 of 3');
    });

    it('settles back onto the first page after flicking back from it', async () => {
      await mountViewer(PageTurnViewer, loadedChapter(3));
      swipe(viewer(), { x: 400, y: 300 }, { x: 600, y: 300 });
      expect(viewer()).toHaveAccessibleName('Page 1 of 3');
      // Where the page sits on screen: jsdom has no layout to measure it by.
      const panel = screen.getByRole('img').closest<HTMLElement>('[data-current]')!;
      await vi.waitFor(() => expect(panel.style.transform).toBe('translateX(calc(0% + 0px))'));
    });
  });
});
