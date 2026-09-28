import { describe, it, expect } from 'vitest';
import { chapterLabel, chapterNumber } from './chapters';

describe('chapterNumber', () => {
  it('shows whole chapters without a decimal', () => {
    expect(chapterNumber('chapter_0045-00')).toBe('45');
    expect(chapterNumber('chapter_1194-00')).toBe('1194');
  });

  it('shows the minor number as the decimal part', () => {
    expect(chapterNumber('chapter_0044-05')).toBe('44.5');
    expect(chapterNumber('chapter_0140-02')).toBe('140.2');
    expect(chapterNumber('chapter_0010-01')).toBe('10.1');
  });

  it('is null for names not in mgdl format', () => {
    expect(chapterNumber('Vol 1 Ch 3')).toBeNull();
    expect(chapterNumber('chapter_12')).toBeNull();
  });
});

describe('chapterLabel', () => {
  it('names a chapter by its number, falling back to its name', () => {
    expect(chapterLabel('chapter_0044-05')).toBe('Ch. 44.5');
    expect(chapterLabel('Vol 1 Ch 3')).toBe('Vol 1 Ch 3');
  });
});
