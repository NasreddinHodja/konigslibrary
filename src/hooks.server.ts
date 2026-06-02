import type { Handle } from '@sveltejs/kit';

const ALLOWED_ORIGINS = new Set(['https://tauri.localhost', 'http://tauri.localhost']);

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://tauri.localhost';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

export const handle: Handle = async ({ event, resolve }) => {
  const origin = event.request.headers.get('origin');

  if (event.request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  const response = await resolve(event);
  const headers = corsHeaders(origin);
  for (const [k, v] of Object.entries(headers)) {
    response.headers.set(k, v);
  }
  return response;
};
