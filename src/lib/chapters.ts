export function detectDepth(names: string[]): { depth: number; commonRoot: string | null } {
  const firstDirs = new Set(names.map((n) => n.split('/')[0]));
  const hasCommonRoot = firstDirs.size === 1 && names.every((n) => n.split('/').length >= 3);
  return {
    depth: hasCommonRoot ? 1 : 0,
    commonRoot: hasCommonRoot ? [...firstDirs][0] : null
  };
}

export function groupByChapter<T extends { name: string }>(
  entries: T[],
  depth: number
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const entry of entries) {
    const segs = entry.name.split('/');
    const chapter = segs.length > depth + 1 ? segs[depth] : '';
    if (!grouped.has(chapter)) grouped.set(chapter, []);
    grouped.get(chapter)!.push(entry);
  }

  for (const [, chapterEntries] of grouped) {
    chapterEntries.sort((a, b) => a.name.localeCompare(b.name));
  }

  return grouped;
}
