import { json } from '@sveltejs/kit';
import { getMangaDir, saveMangaDir } from '$lib/server/library';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  return json({ mangaDir: getMangaDir() });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  if (typeof body.mangaDir !== 'string') {
    return json({ error: 'mangaDir must be a string' }, { status: 400 });
  }
  await saveMangaDir(body.mangaDir);
  return json({ mangaDir: body.mangaDir });
};
