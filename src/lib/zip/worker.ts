import { indexZip, extractEntry } from './index';
import type { ZipEntry } from './index';

type IndexMsg = { id: number; type: 'index'; file: File };
type ExtractMsg = { id: number; type: 'extract'; file: File; entry: ZipEntry };
type WorkerMsg = IndexMsg | ExtractMsg;

self.onmessage = async (e: MessageEvent<WorkerMsg>) => {
  const { id } = e.data;
  try {
    if (e.data.type === 'index') {
      const entries = await indexZip(e.data.file);
      (self as unknown as Worker).postMessage({ id, entries });
    } else {
      const blob = await extractEntry(e.data.file, e.data.entry);
      const buffer = await blob.arrayBuffer();
      (self as unknown as Worker).postMessage({ id, buffer }, [buffer]);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
