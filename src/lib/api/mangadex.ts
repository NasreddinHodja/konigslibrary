const BASE = 'https://api.mangadex.org';

export async function fetchLatestChapter(
  mangadexId: string
): Promise<{ chapter: string; publishAt: string } | null> {
  try {
    const url =
      `${BASE}/manga/${mangadexId}/feed?order[chapter]=desc&limit=1` +
      `&translatedLanguage[]=en&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const entry = json.data?.[0]?.attributes;
    if (!entry) return null;
    return { chapter: entry.chapter ?? '', publishAt: entry.publishAt ?? '' };
  } catch {
    return null;
  }
}
