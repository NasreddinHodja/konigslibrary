const ZIP_ERROR_PATTERNS: [RegExp, string][] = [
  [/^Not a valid ZIP file$/, "This doesn't look like a valid ZIP/CBZ file."],
  [/^Central directory too large$/, 'This ZIP file is too large or malformed to read safely.'],
  [
    /^Entry ".*" uncompressed size \(\d+\) exceeds limit$/,
    'One of the pages in this file is too large to open.'
  ],
  [/^Invalid local file header$/, 'This ZIP file appears to be corrupted.'],
  [
    /^Unsupported compression method: \d+$/,
    "This ZIP file uses a compression method that isn't supported."
  ],
  [/^CRC32 mismatch for/, 'This ZIP file appears to be corrupted (checksum mismatch).']
];

export function describeOpenFileError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  for (const [pattern, friendly] of ZIP_ERROR_PATTERNS) {
    if (pattern.test(message)) return friendly;
  }
  return message;
}
