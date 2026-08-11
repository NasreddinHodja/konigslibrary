import { json } from '@sveltejs/kit';
import { browseDir } from '$lib/server/library';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, getClientAddress }) => {
  const client = getClientAddress();
  if (client !== '127.0.0.1' && client !== '::1') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const result = await browseDir(url.searchParams.get('path') ?? undefined);
    return json(result);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
};
