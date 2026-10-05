import { describe, it, expect } from 'vitest';
import { fakeServer, json } from '$lib/testing/server';
import { isLazyProvider } from './types';
import { openServerManga } from './library';

const SERVER = 'http://192.168.1.5:3000';

/// A server whose Berserk has one chapter of two pages, the second in a
/// folder; answers pages with their bytes.
function server() {
  return fakeServer((url) => {
    if (url.pathname === '/api/library/berserk/chapters')
      return json([{ name: 'ch1', slug: 'ch1.cbz', pageCount: 2, pages: ['1.jpg', 'b w/2.jpg'] }]);
    if (url.pathname.startsWith('/api/library/berserk/ch1.cbz/')) return new Response('jpg');
  });
}

describe("a server manga's pages", () => {
  it("on the server's own page are its URLs", async () => {
    server();
    const provider = openServerManga('berserk', 'Berserk');
    await provider.loadChapters();
    expect(isLazyProvider(provider)).toBe(false);
    if (isLazyProvider(provider)) return;
    expect(await provider.getPageUrls('ch1')).toEqual({
      urls: ['/api/library/berserk/ch1.cbz/1.jpg', '/api/library/berserk/ch1.cbz/b%20w/2.jpg'],
      revoke: false
    });
  });

  it('from a server set in the app are fetched one by one with the token', async () => {
    localStorage.setItem('kl:serverUrl', SERVER);
    localStorage.setItem('kl:serverToken', 'tok');
    const fetch = server();
    const provider = openServerManga('berserk', 'Berserk');
    await provider.loadChapters();
    expect(isLazyProvider(provider)).toBe(true);
    if (!isLazyProvider(provider)) return;
    expect(await provider.getPageUrl('ch1', 1)).toMatch(/^blob:/);
    const [url, init] = fetch.mock.calls.at(-1)!;
    expect(String(url)).toBe(`${SERVER}/api/library/berserk/ch1.cbz/b%20w/2.jpg`);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('from a server set in the app say which page is missing', async () => {
    localStorage.setItem('kl:serverUrl', SERVER);
    localStorage.setItem('kl:serverToken', 'tok');
    server();
    const provider = openServerManga('berserk', 'Berserk');
    await provider.loadChapters();
    if (!isLazyProvider(provider)) throw new Error('not lazy');
    await expect(provider.getPageUrl('ch1', 2)).rejects.toThrow(
      'Page 3 not found in chapter "ch1"'
    );
  });
});
