const ENDPOINT = 'https://graphql.anilist.co';

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
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.errors) return null;
    return json.data as T;
  } catch {
    return null;
  }
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
  const data = await gql<{ Media: Record<string, unknown> }>(QUERY_ONE, { search: query });
  if (!data?.Media) return null;
  return parseManga(data.Media);
}

export async function searchMangaMultiple(query: string, limit = 6): Promise<MangaMeta[]> {
  const data = await gql<{ Page: { media: Record<string, unknown>[] } }>(QUERY_MANY, {
    search: query,
    perPage: limit
  });
  return (data?.Page?.media ?? []).map(parseManga);
}
