export class RateLimitError extends Error {
  constructor() {
    super('AniList rate limit reached');
  }
}

const ENDPOINT = 'https://graphql.anilist.co';

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const CACHE_PREFIX = 'kl:anilist:';

function cacheKey(query: string) {
  return `${CACHE_PREFIX}${query.toLowerCase().trim()}`;
}

function readCache(query: string): MangaMeta | null {
  try {
    const raw = localStorage.getItem(cacheKey(query));
    if (!raw) return null;
    const { meta, cachedAt } = JSON.parse(raw) as { meta: MangaMeta; cachedAt: number };
    if (Date.now() - cachedAt > CACHE_TTL) {
      localStorage.removeItem(cacheKey(query));
      return null;
    }
    return meta;
  } catch {
    return null;
  }
}

function writeCache(query: string, meta: MangaMeta) {
  try {
    localStorage.setItem(cacheKey(query), JSON.stringify({ meta, cachedAt: Date.now() }));
  } catch {
    /* localStorage full or unavailable */
  }
}

export interface MangaMeta {
  id: string;
  mangadexId: string | null;
  title: string;
  description: string;
  status: 'ongoing' | 'completed' | 'hiatus' | 'cancelled';
  year: number | null;
  tags: string[];
  authors: string[];
  coverUrl: string | null;
  latestChapter: string | null;
  latestChapterDate: string | null;
}

const FIELDS = `
  id
  title { romaji english native }
  description(asHtml: false)
  status
  startDate { year }
  coverImage { extraLarge large }
  genres
  tags { name }
  staff(sort: [RELEVANCE], page: 1, perPage: 10) {
    edges { node { name { full } } role }
  }
  externalLinks { site url }
`;

const QUERY_ONE = `query ($search: String) {
  Media(search: $search, type: MANGA, sort: [SEARCH_MATCH]) { ${FIELDS} }
}`;

const QUERY_MANY = `query ($search: String, $perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    media(search: $search, type: MANGA, sort: [SEARCH_MATCH]) { ${FIELDS} }
  }
}`;

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  if (res.status === 429) throw new RateLimitError();
  if (!res.ok) return null;
  const json = await res.json();
  if (json.errors) return null;
  return json.data as T;
}

function mapStatus(s: string): MangaMeta['status'] {
  if (s === 'RELEASING') return 'ongoing';
  if (s === 'FINISHED') return 'completed';
  if (s === 'HIATUS') return 'hiatus';
  if (s === 'CANCELLED') return 'cancelled';
  return 'ongoing';
}

function parseManga(m: Record<string, unknown>): MangaMeta {
  const title = m.title as Record<string, string>;
  const staff = m.staff as {
    edges: Array<{ node: { name: { full: string } }; role: string }>;
  } | null;
  const links = (m.externalLinks as Array<{ site: string; url: string }>) ?? [];

  const mangadexUrl = links.find((l) => l.site === 'MangaDex')?.url ?? null;
  const mangadexId = mangadexUrl?.match(/mangadex\.org\/title\/([^/?#]+)/)?.[1] ?? null;

  const authors = [
    ...new Set(
      (staff?.edges ?? []).filter((e) => /story|art/i.test(e.role)).map((e) => e.node.name.full)
    )
  ];

  const genres = (m.genres as string[]) ?? [];
  const tags = ((m.tags as Array<{ name: string }>) ?? []).map((t) => t.name);
  const cover = m.coverImage as Record<string, string> | null;

  return {
    id: String(m.id),
    mangadexId,
    title: title.english ?? title.romaji ?? title.native ?? '',
    description: (m.description as string) ?? '',
    status: mapStatus(m.status as string),
    year: (m.startDate as { year: number | null } | null)?.year ?? null,
    tags: [...genres, ...tags].slice(0, 15),
    authors,
    coverUrl: cover?.extraLarge ?? cover?.large ?? null,
    latestChapter: null,
    latestChapterDate: null
  };
}

export async function searchManga(query: string): Promise<MangaMeta | null> {
  const cached = readCache(query);
  if (cached) return cached;
  const data = await gql<{ Media: Record<string, unknown> }>(QUERY_ONE, { search: query });
  if (!data?.Media) return null;
  const meta = parseManga(data.Media);
  writeCache(query, meta);
  return meta;
}

export async function searchMangaMultiple(query: string, limit = 6): Promise<MangaMeta[]> {
  const data = await gql<{ Page: { media: Record<string, unknown>[] } }>(QUERY_MANY, {
    search: query,
    perPage: limit
  });
  return (data?.Page?.media ?? []).map(parseManga);
}
