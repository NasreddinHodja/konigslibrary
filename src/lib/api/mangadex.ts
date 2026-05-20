const BASE = 'https://api.mangadex.org';

export interface MangaMeta {
  id: string;
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

function normalizeTitle(raw: string): string {
  return raw
    .replace(/[_\-]+/g, ' ')     // underscores/hyphens → spaces
    .replace(/\s*vol(ume)?\s*\d+/gi, '') // strip "vol 1", "volume 2"
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function searchManga(query: string): Promise<MangaMeta | null> {
  const normalized = normalizeTitle(query);
  const url =
    `${BASE}/manga?title=${encodeURIComponent(normalized)}&limit=5` +
    `&includes[]=cover_art&includes[]=author&includes[]=artist` +
    `&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.data?.length) return null;

  const manga = parseManga(json.data[0]);

  if (manga.status === 'ongoing') {
    const latest = await fetchLatestChapter(manga.id);
    manga.latestChapter = latest?.chapter ?? null;
    manga.latestChapterDate = latest?.publishAt ?? null;
  }

  return manga;
}

async function fetchLatestChapter(
  id: string
): Promise<{ chapter: string; publishAt: string } | null> {
  const url =
    `${BASE}/manga/${id}/feed?order[chapter]=desc&limit=1` +
    `&translatedLanguage[]=en&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const entry = json.data?.[0]?.attributes;
  if (!entry) return null;
  return { chapter: entry.chapter ?? '', publishAt: entry.publishAt ?? '' };
}

function stripMarkdown(raw: string): string {
  return raw
    .split(/\n[-_]{3,}/)[0]                       // cut at --- or ___ separator
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')      // [text](url) → text
    .replace(/\*\*([^*]+)\*\*/g, '$1')            // **bold** → bold
    .replace(/\*([^*]+)\*/g, '$1')                // *italic* → italic
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')        // _italic_ → italic
    .trim();
}

function parseManga(m: Record<string, unknown>): MangaMeta {
  const a = m.attributes as Record<string, unknown>;
  const rels = (m.relationships as Array<Record<string, unknown>>) ?? [];

  const titleObj = a.title as Record<string, string> | undefined;
  const title = titleObj?.en ?? (Object.values(titleObj ?? {})[0] as string) ?? '';

  const descObj = a.description as Record<string, string> | undefined;
  const rawDesc = descObj?.en ?? (Object.values(descObj ?? {})[0] as string) ?? '';
  const description = stripMarkdown(rawDesc);

  const tags = ((a.tags as Array<Record<string, unknown>>) ?? [])
    .map((t) => ((t.attributes as Record<string, unknown>)?.name as Record<string, string>)?.en)
    .filter(Boolean) as string[];

  const authorRels = rels.filter((r) => r.type === 'author' || r.type === 'artist');
  const authors = [
    ...new Set(
      authorRels
        .map((r) => (r.attributes as Record<string, string> | undefined)?.name)
        .filter(Boolean) as string[]
    )
  ];

  const coverRel = rels.find((r) => r.type === 'cover_art');
  const coverFile = (coverRel?.attributes as Record<string, string> | undefined)?.fileName;
  const coverUrl = coverFile
    ? `https://uploads.mangadex.org/covers/${m.id}/${coverFile}.512.jpg`
    : null;

  return {
    id: m.id as string,
    title,
    description,
    status: a.status as MangaMeta['status'],
    year: (a.year as number) ?? null,
    tags,
    authors,
    coverUrl,
    latestChapter: null,
    latestChapterDate: null,
  };
}
