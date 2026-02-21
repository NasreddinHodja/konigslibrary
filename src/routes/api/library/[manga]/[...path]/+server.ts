import type { RequestHandler } from './$types';
import { getImageFromDir, getImageFromZip } from '$lib/server/library';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp'
};

export const GET: RequestHandler = async ({ params }) => {
  const mangaSlug = params.manga;
  const pathStr = params.path;

  const decodedManga = decodeURIComponent(mangaSlug);
  const isZip = /\.(zip|cbz)$/i.test(decodedManga);

  let result: { buffer: Buffer; ext: string } | null = null;

  if (isZip) {
    result = await getImageFromZip(mangaSlug, pathStr);
  } else {
    const parts = pathStr.split('/');
    result = await getImageFromDir(mangaSlug, parts);
  }

  if (!result) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      'Content-Type': MIME[result.ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  });
};
