export type Chapter = {
  name: string;
  pageCount: number;
};

export type LibraryEntry = {
  name: string;
  slug: string;
  type: 'directory' | 'zip';
};

export type ServerChapter = {
  name: string;
  slug: string;
  pageCount: number;
  pages: string[];
};
