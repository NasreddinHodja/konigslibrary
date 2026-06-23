import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchManga, searchMangaMultiple, RateLimitError } from './anilist';

const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
  removeItem: (k: string) => {
    delete store[k];
  },
  clear: () => {
    for (const k in store) delete store[k];
  }
});

function mockMedia(overrides: Record<string, unknown> = {}) {
  return {
    id: 1234,
    title: { english: 'My Manga', romaji: 'Watashi no Manga', native: '私のマンガ' },
    description: 'A great manga.',
    status: 'RELEASING',
    startDate: { year: 2020 },
    coverImage: { extraLarge: 'https://example.com/cover.jpg', large: null },
    genres: ['Action', 'Adventure'],
    tags: [{ name: 'Isekai' }],
    staff: {
      edges: [{ node: { name: { full: 'Jane Doe' } }, role: 'Story & Art' }]
    },
    externalLinks: [{ site: 'MangaDex', url: 'https://mangadex.org/title/abc-123/my-manga' }],
    ...overrides
  };
}

function mockFetch(data: unknown, status = 200) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data
  } as Response);
}

beforeEach(() => {
  for (const k in store) delete store[k];
  vi.restoreAllMocks();
});

describe('RateLimitError', () => {
  it('is an instance of Error', () => {
    expect(new RateLimitError()).toBeInstanceOf(Error);
  });

  it('has the correct message', () => {
    expect(new RateLimitError().message).toBe('AniList rate limit reached');
  });
});

describe('searchManga', () => {
  it('returns null when the fetch response is not ok', async () => {
    mockFetch({}, 500);
    expect(await searchManga('anything')).toBeNull();
  });

  it('throws RateLimitError on a 429 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({})
    } as Response);
    await expect(searchManga('anything')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('returns null when the response contains errors', async () => {
    mockFetch({ errors: [{ message: 'Not found' }] });
    expect(await searchManga('missing')).toBeNull();
  });

  it('returns null when Media is absent from the response', async () => {
    mockFetch({ data: { Media: null } });
    expect(await searchManga('missing')).toBeNull();
  });

  it('parses title, status, year, authors, coverUrl and mangadexId correctly', async () => {
    mockFetch({ data: { Media: mockMedia() } });
    const result = await searchManga('My Manga');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('My Manga');
    expect(result!.status).toBe('ongoing');
    expect(result!.year).toBe(2020);
    expect(result!.authors).toContain('Jane Doe');
    expect(result!.coverUrl).toBe('https://example.com/cover.jpg');
    expect(result!.mangadexId).toBe('abc-123');
  });

  it('maps all AniList status values correctly', async () => {
    const cases: Array<[string, string]> = [
      ['RELEASING', 'ongoing'],
      ['FINISHED', 'completed'],
      ['HIATUS', 'hiatus'],
      ['CANCELLED', 'cancelled'],
      ['NOT_YET_RELEASED', 'ongoing']
    ];
    for (const [anilistStatus, expected] of cases) {
      vi.restoreAllMocks();
      mockFetch({ data: { Media: mockMedia({ status: anilistStatus }) } });
      const result = await searchManga(`status-${anilistStatus}`);
      expect(result!.status).toBe(expected);
    }
  });

  it('falls back to romaji title when english is absent', async () => {
    mockFetch({
      data: {
        Media: mockMedia({ title: { english: null, romaji: 'Romaji Title', native: null } })
      }
    });
    const result = await searchManga('test');
    expect(result!.title).toBe('Romaji Title');
  });

  it('returns null mangadexId when no MangaDex external link exists', async () => {
    mockFetch({ data: { Media: mockMedia({ externalLinks: [] }) } });
    const result = await searchManga('test');
    expect(result!.mangadexId).toBeNull();
  });

  it('merges genres and tags into the tags field', async () => {
    mockFetch({ data: { Media: mockMedia() } });
    const result = await searchManga('test');
    expect(result!.tags).toContain('Action');
    expect(result!.tags).toContain('Adventure');
    expect(result!.tags).toContain('Isekai');
  });

  it('caches the result and does not fetch again on the same query', async () => {
    mockFetch({ data: { Media: mockMedia() } });
    await searchManga('cache-query');
    vi.restoreAllMocks();
    const spy = vi.spyOn(globalThis, 'fetch');
    await searchManga('cache-query');
    expect(spy).not.toHaveBeenCalled();
  });

  it('treats the cache as case-insensitive', async () => {
    mockFetch({ data: { Media: mockMedia() } });
    await searchManga('Case Query');
    vi.restoreAllMocks();
    const spy = vi.spyOn(globalThis, 'fetch');
    await searchManga('case query');
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores a cache entry that is older than 7 days', async () => {
    const staleEntry = {
      meta: { title: 'Stale' },
      cachedAt: Date.now() - 8 * 24 * 60 * 60 * 1000
    };
    store['kl:anilist:stale manga'] = JSON.stringify(staleEntry);
    mockFetch({
      data: { Media: mockMedia({ title: { english: 'Fresh', romaji: null, native: null } }) }
    });
    const result = await searchManga('stale manga');
    expect(result!.title).toBe('Fresh');
  });
});

describe('searchMangaMultiple', () => {
  it('returns an array of parsed results', async () => {
    mockFetch({
      data: {
        Page: {
          media: [
            mockMedia(),
            mockMedia({ id: 5678, title: { english: 'Other', romaji: null, native: null } })
          ]
        }
      }
    });
    const results = await searchMangaMultiple('test', 2);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('My Manga');
    expect(results[1].title).toBe('Other');
  });

  it('returns an empty array on fetch failure', async () => {
    mockFetch({}, 500);
    const results = await searchMangaMultiple('test');
    expect(results).toEqual([]);
  });

  it('returns an empty array when Page.media is missing', async () => {
    mockFetch({ data: { Page: { media: null } } });
    const results = await searchMangaMultiple('test');
    expect(results).toEqual([]);
  });
});
