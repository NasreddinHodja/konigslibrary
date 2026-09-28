// Chapter archives are named by mgdl as `chapter_<major>-<minor>`: minor 00 is
// a whole chapter, anything else is its decimal part (`chapter_0044-05` is
// 44.5). Same rule as mgdl's `Chapter::display_number`.
const MGDL_NAME = /^chapter_(\d+)-(\d+)$/;

/// The chapter number encoded in an mgdl chapter name, or `null` for any other
/// name.
export function chapterNumber(name: string): string | null {
  const match = MGDL_NAME.exec(name);
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
