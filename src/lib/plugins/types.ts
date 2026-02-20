import type { ReaderServices } from '$lib/context';

export type Plugin = {
  name: string;
  install?(services: ReaderServices): void;
  onSourceLoaded?(mangaName: string): void;
  onChapterChanged?(from: string | null, to: string | null): void;
  onPageChanged?(page: number): void;
  destroy?(): void;
};
