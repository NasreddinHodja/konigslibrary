// Runs the wasm parser off the main thread. Inflating and CRC-checking a page
// is CPU work; doing it inline would stall scrolling.
//
// Only this worker instantiates the wasm module, so there is exactly one copy
// of it and one wasm heap per tab.
import { pageEntries, extractEntry, sortNames, mangaMeta } from './index';
import type { ZipEntry } from './index';
import { errorMessage } from '$lib/utils/errors';

type WorkerMsg = { id: number } & (
  | { type: 'pages'; file: File }
  | { type: 'extract'; file: File; entry: ZipEntry }
  | { type: 'sort'; names: string[] }
  | { type: 'meta'; files: File[] }
);

self.onmessage = async (e: MessageEvent<WorkerMsg>) => {
  const msg = e.data;
  const post = (data: object, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage({ id: msg.id, ...data }, transfer);
  try {
    switch (msg.type) {
      case 'pages':
        return post({ result: await pageEntries(msg.file) });
      case 'extract': {
        const buffer = await (await extractEntry(msg.file, msg.entry)).arrayBuffer();
        return post({ result: buffer }, [buffer]);
      }
      case 'sort':
        return post({ result: await sortNames(msg.names) });
      case 'meta':
        return post({ result: await mangaMeta(msg.files) });
    }
  } catch (err) {
    // The name carries a zip error's code (see describeOpenFileError).
    post({ error: errorMessage(err), name: err instanceof Error ? err.name : undefined });
  }
};
