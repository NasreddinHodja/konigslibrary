import type { Reader } from '$lib/context';

export type Plugin = {
  name: string;
  install?(reader: Reader): void;
  onSourceLoaded?(mangaName: string): void;
  onChapterChanged?(from: string | null, to: string | null): void;
  onPageChanged?(page: number): void;
  destroy?(): void;
};
