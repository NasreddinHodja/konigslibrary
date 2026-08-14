import type { GroupedChapters, ZipEntry } from './index';

type Resolver = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type WorkerResponse =
  | { id: number; grouped: GroupedChapters }
  | { id: number; buffer: ArrayBuffer }
  | { id: number; error: string };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Resolver>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if ('error' in e.data) {
        p.reject(new Error(e.data.error));
      } else if ('grouped' in e.data) {
        p.resolve(e.data.grouped);
      } else {
        p.resolve(e.data.buffer);
      }
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

async function call<T>(msg: object, transfer?: Transferable[]): Promise<T> {
  try {
    return await dispatch<T>(msg, transfer);
  } catch (err) {
    if (worker === null) {
      return dispatch<T>(msg, transfer);
    }
    throw err;
  }
}

function dispatch<T>(msg: object, transfer?: Transferable[]): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    const w = getWorker();
    w.postMessage({ id, ...msg }, transfer ?? []);
  });
}

export function loadChaptersWorker(file: File): Promise<GroupedChapters> {
  return call<GroupedChapters>({ type: 'chapters', file });
}

export async function extractEntryWorker(file: File, entry: ZipEntry): Promise<Blob> {
  const buffer = await call<ArrayBuffer>({ type: 'extract', file, entry });
  return new Blob([buffer]);
}
