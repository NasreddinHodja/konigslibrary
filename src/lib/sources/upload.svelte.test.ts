import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { initParser } from '$lib/zip';
import { createReader } from '$lib/context';
import type { Reader } from '$lib/context';
import { chapterFile } from '$lib/testing/zip';
import { UploadProvider, droppedUpload, openUpload, pickedFolder } from './upload';

// The parsing runs in a Web Worker, which jsdom lacks; these are the functions
// that worker calls, run here instead.
vi.mock('$lib/zip/worker-client', async () => {
  const zip = await import('$lib/zip');
  return {
    chapterEntriesWorker: zip.chapterEntries,
    extractEntryWorker: zip.extractEntry,
    sortChaptersWorker: zip.sortChapters,
    mangaMetaWorker: zip.mangaMeta
  };
});

beforeAll(async () => {
  // From the project root: under jsdom, import.meta.url isn't a file URL.
  await initParser(readFileSync('src/lib/zip/wasm/klwasm_bg.wasm'));
});

const comicInfo = (fields: string) => `<?xml version="1.0"?><ComicInfo>${fields}</ComicInfo>`;

describe('UploadProvider', () => {
  it("lists a folder's chapter archives in reading order, with their page counts", async () => {
    const provider = new UploadProvider(
      [chapterFile('Ch 10.cbz', 3), chapterFile('Ch 2.zip', 2), chapterFile('Ch 1.cbz', 4)],
      'Berserk'
    );
    expect(await provider.loadChapters()).toEqual([
      { name: 'Ch 1', pageCount: 4 },
      { name: 'Ch 2', pageCount: 2 },
      { name: 'Ch 10', pageCount: 3 }
    ]);
  });

  it('leaves out what is not a chapter archive, hidden files included', async () => {
    const provider = new UploadProvider(
      [
        chapterFile('Ch 1.cbz', 1),
        chapterFile('._Ch 1.cbz', 1),
        new File(['x'], 'cover.jpg'),
        new File(['x'], 'notes.txt')
      ],
      'Berserk'
    );
    expect((await provider.loadChapters()).map((c) => c.name)).toEqual(['Ch 1']);
  });

  it('skips a corrupt archive among others, and one without pages', async () => {
    const provider = new UploadProvider(
      [chapterFile('Ch 1.cbz', 2), new File(['nope'], 'Ch 2.cbz'), chapterFile('Ch 3.cbz', 0)],
      'Berserk'
    );
    expect((await provider.loadChapters()).map((c) => c.name)).toEqual(['Ch 1']);
  });

  it('fails on a single archive that is corrupt', async () => {
    const provider = new UploadProvider([new File(['nope'], 'Ch 1.cbz')], 'Ch 1');
    await expect(provider.loadChapters()).rejects.toMatchObject({ name: 'not-a-zip' });
  });

  it('refuses a folder of more chapters than the limit, before reading them', async () => {
    const files = Array.from({ length: 5001 }, (_, i) => new File([], `${i}.cbz`));
    await expect(new UploadProvider(files, 'Huge').loadChapters()).rejects.toThrow(
      '5001 chapter archives; a manga can have at most 5000'
    );
  });

  it('serves each page from its archive', async () => {
    const create = vi.spyOn(URL, 'createObjectURL');
    const provider = new UploadProvider([chapterFile('Ch 1.cbz', 3)], 'Berserk');
    await provider.loadChapters();
    const url = await provider.getPageUrl('Ch 1', 1);
    expect(url).toBe(create.mock.results[0].value);
    const blob = create.mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe('Ch 1.cbz page 2');
  });

  it('says which page is missing', async () => {
    const provider = new UploadProvider([chapterFile('Ch 1.cbz', 3)], 'Berserk');
    await provider.loadChapters();
    await expect(provider.getPageUrl('Ch 1', 3)).rejects.toThrow(
      'Page 4 not found in chapter "Ch 1"'
    );
    await expect(provider.getPageUrl('Ch 9', 0)).rejects.toThrow('not found in chapter "Ch 9"');
  });

  it('reads the metadata and cover from the folder, and lets go of the cover after', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const cover = new File(['img'], 'cover.jpg');
    const provider = new UploadProvider(
      [
        chapterFile('Ch 1.cbz', 1, {
          'ComicInfo.xml': comicInfo(
            '<Series>Berserk</Series><Writer>Kentaro Miura</Writer><Year>1989</Year>'
          )
        }),
        cover
      ],
      'berserk'
    );
    const meta = await provider.loadMeta();
    expect(meta).toMatchObject({ title: 'Berserk', authors: ['Kentaro Miura'], year: 1989 });
    expect(meta?.coverUrl).toMatch(/^blob:/);
    provider.dispose();
    expect(revoke).toHaveBeenCalledWith(meta?.coverUrl);
  });

  it('gives no cover URL for a folder without one', async () => {
    const provider = new UploadProvider([chapterFile('Ch 1.cbz', 1)], 'berserk');
    expect((await provider.loadMeta())?.coverUrl).toBeNull();
  });
});

describe('picking a folder', () => {
  const inFolder = (path: string) => {
    const file = new File(['x'], path.split('/').pop()!);
    Object.defineProperty(file, 'webkitRelativePath', { value: path });
    return file;
  };

  it('takes the files directly inside it, named after it', () => {
    const upload = pickedFolder([
      inFolder('Berserk/Ch 1.cbz'),
      inFolder('Berserk/cover.jpg'),
      inFolder('Berserk/extras/art.cbz')
    ]);
    expect(upload?.name).toBe('Berserk');
    expect(upload?.single).toBe(false);
    expect(upload?.files.map((f) => f.name)).toEqual(['Ch 1.cbz', 'cover.jpg']);
  });

  it('gives nothing for an empty folder', () => {
    expect(pickedFolder([inFolder('Berserk/extras/art.cbz')])).toBeNull();
  });
});

describe('dropping', () => {
  /// What the browser hands a drop handler for a folder of `files`, read in
  /// batches of `batch` the way readEntries does.
  function droppedFolder(name: string, files: File[], batch = 2): DataTransfer {
    const children = files.map((file) => ({
      isFile: true,
      isDirectory: false,
      name: file.name,
      file: (ok: (f: File) => void) => ok(file)
    }));
    let read = 0;
    const dir = {
      isDirectory: true,
      name,
      createReader: () => ({
        readEntries: (ok: (b: unknown[]) => void) => ok(children.slice(read, (read += batch)))
      })
    };
    return {
      items: [{ webkitGetAsEntry: () => dir }],
      files: []
    } as unknown as DataTransfer;
  }

  const droppedFile = (file: File) =>
    ({
      items: [{ webkitGetAsEntry: () => ({ isDirectory: false }) }],
      files: [file]
    }) as unknown as DataTransfer;

  it("takes a folder's chapter archives and cover, read in every batch", async () => {
    const upload = await droppedUpload(
      droppedFolder('Berserk', [
        new File([], 'Ch 1.cbz'),
        new File([], 'notes.txt'),
        new File([], '.hidden.cbz'),
        new File([], 'cover.png'),
        new File([], 'Ch 2.zip')
      ])
    );
    expect(upload?.name).toBe('Berserk');
    expect(upload?.single).toBe(false);
    expect(upload?.files.map((f) => f.name)).toEqual(['Ch 1.cbz', 'cover.png', 'Ch 2.zip']);
  });

  it('gives nothing for a folder holding no manga', async () => {
    expect(await droppedUpload(droppedFolder('Stuff', [new File([], 'a.txt')]))).toBeNull();
  });

  it('takes a single chapter archive, to open straight away', async () => {
    const upload = await droppedUpload(droppedFile(new File([], 'Ch 5.cbz')));
    expect(upload).toMatchObject({ name: 'Ch 5', single: true });
  });

  it('gives nothing for a single file that is not an archive', async () => {
    expect(await droppedUpload(droppedFile(new File([], 'page.jpg')))).toBeNull();
  });
});

describe('openUpload', () => {
  let destroy: (() => void) | undefined;
  afterEach(() => destroy?.());

  function reader(): Reader {
    let r!: Reader;
    destroy = $effect.root(() => {
      r = createReader();
    });
    return r;
  }

  it('opens a single chapter straight into the reader', async () => {
    const r = reader();
    await openUpload(r, { files: [chapterFile('Ch 5.cbz', 2)], name: 'Ch 5', single: true });
    expect(r.state).toMatchObject({ selectedChapter: 'Ch 5', currentPage: 0 });
  });

  it('opens a folder at its chapter list', async () => {
    const r = reader();
    await openUpload(r, {
      files: [chapterFile('Ch 1.cbz', 1), chapterFile('Ch 2.cbz', 1)],
      name: 'Berserk',
      single: false
    });
    expect(r.chapters).toHaveLength(2);
    expect(r.state.selectedChapter).toBeNull();
  });
});
