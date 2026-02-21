export function detectDepth(names: string[]): { depth: number; commonRoot: string | null } {
  if (names.length === 0) return { depth: 0, commonRoot: null };

  const split = names.map((n) => n.split('/'));
  const minLen = split.reduce((min, s) => Math.min(min, s.length), Infinity);
  let depth = 0;

  for (let i = 0; i < minLen - 2; i++) {
    const val = split[0][i];
    if (split.every((s) => s[i] === val)) {
      depth = i + 1;
    } else {
      break;
    }
  }

  const commonRoot = depth > 0 ? split[0].slice(0, depth).join('/') : null;
  return { depth, commonRoot };
}

export function groupByChapter<T extends { name: string }>(
  entries: T[],
  depth: number
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const entry of entries) {
    const segs = entry.name.split('/');
    // Use the segment at depth, but if that segment repeats the common root
    // (redundant nesting), skip to the next meaningful segment
    let chapter = segs.length > depth + 1 ? segs[depth] : '';
    if (chapter && depth > 0 && chapter === segs[depth - 1] && segs.length > depth + 2) {
      chapter = segs[depth + 1];
    }
    if (!grouped.has(chapter)) grouped.set(chapter, []);
    grouped.get(chapter)!.push(entry);
  }

  for (const [, chapterEntries] of grouped) {
    chapterEntries.sort((a, b) => a.name.localeCompare(b.name));
  }

  return grouped;
}
