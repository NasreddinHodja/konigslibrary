import { describe, it, expect } from 'vitest';
import { detectDepth, groupByChapter } from '$lib/chapters';

describe('detectDepth', () => {
  it('returns depth 0 for flat files', () => {
    const result = detectDepth(['page01.png', 'page02.png']);
    expect(result).toEqual({ depth: 0, commonRoot: null });
  });

  it('returns depth 0 for empty input', () => {
    expect(detectDepth([])).toEqual({ depth: 0, commonRoot: null });
  });

  it('returns depth 0 for single-level directories', () => {
    const names = ['ch01/page01.png', 'ch01/page02.png', 'ch02/page01.png'];
    const result = detectDepth(names);
    expect(result.depth).toBe(0);
  });

  it('detects common root at depth 1', () => {
    const names = ['manga/ch01/page01.png', 'manga/ch01/page02.png', 'manga/ch02/page01.png'];
    const result = detectDepth(names);
    expect(result.depth).toBe(1);
    expect(result.commonRoot).toBe('manga');
  });

  it('detects deeper common root', () => {
    const names = ['root/manga/vol1/ch01/page01.png', 'root/manga/vol1/ch02/page01.png'];
    const result = detectDepth(names);
    expect(result.depth).toBeGreaterThanOrEqual(1);
    expect(result.commonRoot).not.toBeNull();
  });
});

describe('groupByChapter', () => {
  it('groups flat files into a single chapter', () => {
    const entries = [{ name: 'page01.png' }, { name: 'page02.png' }];
    const groups = groupByChapter(entries, 0);
    expect(groups.size).toBe(1);
    expect(groups.get('')).toHaveLength(2);
  });

  it('groups by first directory at depth 0', () => {
    const entries = [
      { name: 'ch01/page01.png' },
      { name: 'ch01/page02.png' },
      { name: 'ch02/page01.png' }
    ];
    const groups = groupByChapter(entries, 0);
    expect(groups.size).toBe(2);
    expect(groups.get('ch01')).toHaveLength(2);
    expect(groups.get('ch02')).toHaveLength(1);
  });

  it('groups by segment at specified depth', () => {
    const entries = [
      { name: 'manga/ch01/page01.png' },
      { name: 'manga/ch01/page02.png' },
      { name: 'manga/ch02/page01.png' }
    ];
    const groups = groupByChapter(entries, 1);
    expect(groups.size).toBe(2);
    expect(groups.has('ch01')).toBe(true);
    expect(groups.has('ch02')).toBe(true);
  });

  it('sorts entries within each chapter by name', () => {
    const entries = [
      { name: 'ch01/page03.png' },
      { name: 'ch01/page01.png' },
      { name: 'ch01/page02.png' }
    ];
    const groups = groupByChapter(entries, 0);
    const pages = groups.get('ch01')!;
    expect(pages.map((p) => p.name)).toEqual([
      'ch01/page01.png',
      'ch01/page02.png',
      'ch01/page03.png'
    ]);
  });
});
