export type Chapter = {
  name: string;
  pageCount: number;
};

export type LibraryEntry = {
  name: string;
  slug: string;
  /// From the server's library database; absent from servers older than it.
  title?: string | null;
  cover?: string | null;
  coverVersion?: string | null;
  /// Whether `title` and `cover` have been read, so a missing one is final.
  scanned?: boolean;
};

/// One page of a listing; `next` resumes after it and is null on the last page.
export type Page<T> = {
  entries: T[];
  next: string | null;
};

export type ServerChapter = {
  name: string;
  slug: string;
  pageCount: number;
  pages: string[];
};
