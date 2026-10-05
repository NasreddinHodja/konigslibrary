import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeServer, json } from '$lib/testing/server';

// Whether the session was lost is module state, so each test loads the module
// afresh.
let auth: typeof import('./auth.svelte');

beforeEach(async () => {
  vi.resetModules();
  auth = await import('./auth.svelte');
});

const SERVER = 'http://192.168.1.5:3000';

/// The app pointed at `SERVER`, logged in with `token` if given.
function inApp(token?: string) {
  localStorage.setItem('kl:serverUrl', SERVER);
  if (token) localStorage.setItem('kl:serverToken', token);
}

const header = (init: RequestInit | undefined, name: string) =>
  new Headers(init?.headers).get(name);
const sent = (init: RequestInit | undefined) => JSON.parse(String(init?.body));

describe('requests', () => {
  it('carry the bearer token to a server set in the app', async () => {
    inApp('tok');
    const fetch = fakeServer(() => json([]));
    await auth.apiFetch('/api/library');
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(`${SERVER}/api/library`);
    expect(header(init, 'Authorization')).toBe('Bearer tok');
  });

  it("leave the server's own page to its cookie", async () => {
    localStorage.setItem('kl:serverToken', 'stale');
    const fetch = fakeServer(() => json([]));
    await auth.apiFetch('/api/library');
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('/api/library');
    expect(header(init, 'Authorization')).toBeNull();
  });

  it('keep the headers they were given', async () => {
    inApp('tok');
    const fetch = fakeServer(() => json({}));
    await auth.apiFetch('/api/settings', { headers: { 'Content-Type': 'application/json' } });
    expect(header(fetch.mock.calls[0][1], 'Content-Type')).toBe('application/json');
  });

  it('turned away for want of a session lose it', async () => {
    inApp('tok');
    fakeServer(() => json({ error: 'Unauthorized' }, 401));
    expect(auth.sessionLost()).toBe(false);
    await auth.apiFetch('/api/library');
    expect(auth.sessionLost()).toBe(true);
  });

  it('refused for another reason keep it', async () => {
    inApp('tok');
    fakeServer(() => json({ error: 'Cross-site request refused' }, 403));
    await auth.apiFetch('/api/library');
    expect(auth.sessionLost()).toBe(false);
  });
});

describe('server images', () => {
  it('need the header only from a server set in the app', () => {
    expect(auth.needsHeader('/api/library/berserk/cover.png')).toBe(false);
    inApp('tok');
    expect(auth.needsHeader(`${SERVER}/api/library/berserk/cover.png`)).toBe(true);
    expect(auth.needsHeader('blob:test/1')).toBe(false);
    expect(auth.needsHeader(`${SERVER}0/api/library/berserk/cover.png`)).toBe(false);
  });

  it('are fetched with it into an object URL', async () => {
    inApp('tok');
    const fetch = fakeServer(() => new Response(new Blob(['png'])));
    const url = await auth.imageObjectUrl(`${SERVER}/api/library/berserk/cover.png`);
    expect(url).toMatch(/^blob:/);
    expect(header(fetch.mock.calls[0][1], 'Authorization')).toBe('Bearer tok');
  });

  it('fail on an error status', async () => {
    inApp('tok');
    fakeServer(() => new Response('', { status: 404 }));
    await expect(auth.imageObjectUrl(`${SERVER}/api/library/x/cover.png`)).rejects.toThrow(
      'Server responded with 404'
    );
  });
});

describe('logging in', () => {
  it('from the app keeps the token and the device token', async () => {
    inApp();
    const fetch = fakeServer(() => json({ username: 'admin', token: 'tok', deviceToken: 'dev' }));
    await auth.login('admin', 'hunter22');
    expect(sent(fetch.mock.calls[0][1])).toMatchObject({
      username: 'admin',
      password: 'hunter22',
      client: 'bearer'
    });
    expect(localStorage.getItem('kl:serverToken')).toBe('tok');

    const next = fakeServer(() => json({ username: 'admin', token: 'tok2', deviceToken: null }));
    await auth.login('admin', 'hunter22');
    expect(sent(next.mock.calls[0][1])).toMatchObject({ deviceToken: 'dev' });
    expect(localStorage.getItem('kl:serverToken')).toBe('tok2');
  });

  it("keeps each server's device token apart", async () => {
    inApp();
    fakeServer(() => json({ username: 'admin', token: 'tok', deviceToken: 'dev' }));
    await auth.login('admin', 'hunter22');
    localStorage.setItem('kl:serverUrl', 'http://elsewhere:3000');
    const fetch = fakeServer(() => json({ username: 'admin', token: 'tok', deviceToken: 'dev2' }));
    await auth.login('admin', 'hunter22');
    expect(sent(fetch.mock.calls[0][1]).deviceToken).toBeNull();
  });

  it("from the server's own page asks for the cookie", async () => {
    const fetch = fakeServer(() => json({ username: 'admin' }));
    await auth.login('admin', 'hunter22');
    const body = sent(fetch.mock.calls[0][1]);
    expect(body.client).toBe('cookie');
    expect(body).not.toHaveProperty('deviceToken');
    expect(localStorage.getItem('kl:serverToken')).toBeNull();
  });

  it("says why it failed, in the server's words", async () => {
    inApp();
    fakeServer(() => json({ error: 'Wrong username or password' }, 401));
    await expect(auth.login('admin', 'nope')).rejects.toThrow('Wrong username or password');
    expect(localStorage.getItem('kl:serverToken')).toBeNull();
  });

  it('says what came back from a server that gave no reason', async () => {
    inApp();
    fakeServer(() => new Response('<!doctype html>', { status: 502 }));
    await expect(auth.login('admin', 'nope')).rejects.toThrow('Could not log in (502)');
  });

  it('gets the session back', async () => {
    inApp('old');
    fakeServer(() => json({ error: 'Unauthorized' }, 401));
    await auth.apiFetch('/api/library');
    fakeServer(() => json({ username: 'admin', token: 'tok', deviceToken: null }));
    await auth.login('admin', 'hunter22');
    expect(auth.sessionLost()).toBe(false);
  });
});

describe('setting up', () => {
  it('sends the setup token with the new account, and logs in', async () => {
    inApp();
    const fetch = fakeServer(() => json({ username: 'admin', token: 'tok', deviceToken: 'dev' }));
    await auth.setup('setup-token', 'admin', 'hunter22');
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(`${SERVER}/api/auth/setup`);
    expect(sent(init)).toEqual({
      token: 'setup-token',
      username: 'admin',
      password: 'hunter22',
      client: 'bearer'
    });
    expect(localStorage.getItem('kl:serverToken')).toBe('tok');
  });

  it('is needed only while the server says so', async () => {
    fakeServer(() => json({ needed: true }));
    expect(await auth.setupNeeded()).toBe(true);
    fakeServer(() => json({ needed: false }));
    expect(await auth.setupNeeded()).toBe(false);
  });

  it("can't be checked on a server from before accounts", async () => {
    fakeServer(() => json({ entries: [] }));
    await expect(auth.setupNeeded()).rejects.toThrow('Not a konigslibrary server');
  });
});

describe('logging out', () => {
  it('ends the session and drops the token', async () => {
    inApp('tok');
    const fetch = fakeServer(() => new Response(null, { status: 204 }));
    await auth.logout();
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(`${SERVER}/api/auth/logout`);
    expect(init?.method).toBe('POST');
    expect(localStorage.getItem('kl:serverToken')).toBeNull();
    expect(auth.sessionLost()).toBe(true);
  });

  it('drops the token even when the server is gone', async () => {
    inApp('tok');
    await expect(auth.logout()).rejects.toThrow();
    expect(localStorage.getItem('kl:serverToken')).toBeNull();
  });
});

describe('the account', () => {
  it('is no one when logged out, without leaving Settings', async () => {
    inApp('tok');
    fakeServer(() => json({ error: 'Unauthorized' }, 401));
    expect(await auth.fetchMe()).toBeNull();
    expect(auth.sessionLost()).toBe(false);
  });

  it("is the admin's", async () => {
    inApp('tok');
    fakeServer(() => json({ username: 'admin', session: 's1' }));
    expect(await auth.fetchMe()).toMatchObject({ username: 'admin' });
  });
});
