// chapter_0044-00 is 44, chapter_0044-05 is 44.5.
const NUMBERED_NAME = /^chapter_(\d+)-(\d+)$/;

export function chapterNumber(name: string): string | null {
  const match = NUMBERED_NAME.exec(name);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return minor === 0 ? `${major}` : `${major}.${minor}`;
}

/// What to call a chapter in the UI: its number, or its name when it has none.
export function chapterLabel(name: string): string {
  const number = chapterNumber(name);
  return number === null ? name : `Ch. ${number}`;
}
