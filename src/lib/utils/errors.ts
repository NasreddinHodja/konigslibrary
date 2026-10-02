/// What to tell the user for each zip error, by the code klparse gives it
/// (`ZipError::code`), which arrives as the error's `name`.
const ZIP_ERROR_MESSAGES: Record<string, string> = {
  'not-a-zip': "This doesn't look like a valid ZIP/CBZ file.",
  'central-directory-too-large': 'This ZIP file is too large or malformed to read safely.',
  'entry-too-large': 'One of the pages in this file is too large to open.',
  'invalid-local-header': 'This ZIP file appears to be corrupted.',
  'unsupported-compression-method': "This ZIP file uses a compression method that isn't supported.",
  'crc32-mismatch': 'This ZIP file appears to be corrupted (checksum mismatch).',
  inflate: 'This ZIP file appears to be corrupted.'
};

/// The message of a thrown value: an Error's own message (without the
/// `Error: ` prefix String() adds), else `fallback` or the value as a string.
export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message;
  return fallback ?? String(err);
}

export function describeOpenFileError(err: unknown): string {
  const friendly = err instanceof Error ? ZIP_ERROR_MESSAGES[err.name] : undefined;
  return friendly ?? errorMessage(err);
}
