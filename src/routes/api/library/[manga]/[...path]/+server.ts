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

  // Determine if this manga is a ZIP or directory
  const decodedManga = decodeURIComponent(mangaSlug);
  const isZip = /\.(zip|cbz)$/i.test(decodedManga);

  let result: { buffer: Buffer; ext: string } | null = null;

  if (isZip) {
    // For ZIPs, the path is the entry name inside the archive
    result = await getImageFromZip(mangaSlug, pathStr);
  } else {
    // For directories, split the path into segments
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
