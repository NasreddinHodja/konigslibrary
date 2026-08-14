// Runs the wasm parser off the main thread. Inflating and CRC-checking a page
// is CPU work; doing it inline would stall scrolling.
//
// Only this worker instantiates the wasm module, so there is exactly one copy
// of it and one wasm heap per tab.
import { indexZip, extractEntry, groupChapters } from './index';
import type { ZipEntry } from './index';

type ChaptersMsg = { id: number; type: 'chapters'; file: File };
type ExtractMsg = { id: number; type: 'extract'; file: File; entry: ZipEntry };
type WorkerMsg = ChaptersMsg | ExtractMsg;

self.onmessage = async (e: MessageEvent<WorkerMsg>) => {
  const { id } = e.data;
  try {
    if (e.data.type === 'chapters') {
      const entries = await indexZip(e.data.file);
      const grouped = await groupChapters(entries);
      (self as unknown as Worker).postMessage({ id, grouped });
    } else {
      const blob = await extractEntry(e.data.file, e.data.entry);
      const buffer = await blob.arrayBuffer();
      (self as unknown as Worker).postMessage({ id, buffer }, [buffer]);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
