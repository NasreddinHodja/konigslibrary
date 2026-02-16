import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listChapters } from '$lib/server/library';

export const GET: RequestHandler = async ({ params }) => {
  const chapters = await listChapters(params.manga);
  return json(chapters);
};
