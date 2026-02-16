import { json } from '@sveltejs/kit';
import { listManga } from '$lib/server/library';

export async function GET() {
  const entries = await listManga();
  return json(entries);
}
