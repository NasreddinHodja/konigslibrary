import type { ReaderServices } from '$lib/context';

export type PipelineInput = {
  urls: string[];
  revoke: boolean;
  services: ReaderServices;
};

export type PipelineOutput = {
  urls: string[];
  revoke: boolean;
  decoded: Map<number, HTMLImageElement>;
};

export type Middleware = (
  input: PipelineInput,
  next: () => Promise<PipelineOutput>,
  signal: AbortSignal
) => Promise<PipelineOutput>;
