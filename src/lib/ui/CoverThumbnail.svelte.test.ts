import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import CoverThumbnail from './CoverThumbnail.svelte';
import { fakeServer } from '$lib/testing/server';

const SERVER = 'http://192.168.1.5:3000';
const COVER = `${SERVER}/api/library/berserk/cover.png`;

function renderCover(src: string | null) {
  return render(CoverThumbnail, {
    src,
    caption: 'Berserk',
    alt: 'Open Berserk',
    onclick: () => {}
  });
}

const image = () =>
  within(screen.getByRole('button', { name: 'Open Berserk' })).queryByRole('presentation');

describe('a cover', () => {
  it("from the server's own page is its URL", () => {
    renderCover('/api/library/berserk/cover.png');
    expect(image()).toHaveAttribute('src', '/api/library/berserk/cover.png');
  });

  it('from a server set in the app is fetched with the token', async () => {
    localStorage.setItem('kl:serverUrl', SERVER);
    localStorage.setItem('kl:serverToken', 'tok');
    const fetch = fakeServer((url) =>
      url.href === COVER ? new Response(new Blob(['png'])) : undefined
    );
    renderCover(COVER);
    await vi.waitFor(() => expect(image()).toHaveAttribute('src', expect.stringMatching(/^blob:/)));
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('never shows the last cover while the next one comes', async () => {
    localStorage.setItem('kl:serverUrl', SERVER);
    localStorage.setItem('kl:serverToken', 'tok');
    fakeServer((url) =>
      url.href === COVER ? new Response(new Blob(['png'])) : new Promise(() => {})
    );
    const { rerender } = renderCover(COVER);
    await vi.waitFor(() => expect(image()).toBeInTheDocument());
    await rerender({ src: `${SERVER}/api/library/vagabond/cover.png` });
    expect(image()).not.toBeInTheDocument();
  });

  it("is let go of once it's gone", async () => {
    localStorage.setItem('kl:serverUrl', SERVER);
    localStorage.setItem('kl:serverToken', 'tok');
    fakeServer(() => new Response(new Blob(['png'])));
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const { unmount } = renderCover(COVER);
    await vi.waitFor(() => expect(image()).toBeInTheDocument());
    const src = image()!.getAttribute('src');
    unmount();
    expect(revoke).toHaveBeenCalledWith(src);
  });

  it("that couldn't be fetched shows none", async () => {
    localStorage.setItem('kl:serverUrl', SERVER);
    localStorage.setItem('kl:serverToken', 'tok');
    fakeServer(() => new Response('', { status: 404 }));
    const fetched = vi.spyOn(URL, 'createObjectURL');
    renderCover(COVER);
    await new Promise((r) => setTimeout(r, 20));
    expect(image()).not.toBeInTheDocument();
    expect(fetched).not.toHaveBeenCalled();
  });
});
