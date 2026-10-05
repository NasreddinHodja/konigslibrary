import { vi } from 'vitest';

/// The server, at the fetch boundary: `handle` gets each request's URL and
/// options and answers it; anything it returns undefined for is a 404.
/// Returns the fetch mock, to see what was asked for.
export function fakeServer(
  handle: (url: URL, init?: RequestInit) => Response | undefined | Promise<Response | undefined>
) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://server.test');
    return (await handle(url, init)) ?? new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/// The server can't be reached: fetch rejects, as it does offline.
export function serverDown() {
  const fetch = vi.fn(async () => {
    throw new TypeError('Failed to fetch');
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });
