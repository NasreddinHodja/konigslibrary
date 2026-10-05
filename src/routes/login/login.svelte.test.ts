import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Login from './+page.svelte';
import { fakeServer, json } from '$lib/testing/server';

const nav = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: nav.goto }));

const SERVER = 'http://192.168.1.5:3000';

/// The server: set up or not, answering logins with `login` and a login
/// waiting for approval with `wait`. Returns each request's path and body.
function server({
  needed = false,
  login = () => json({ username: 'admin', token: 'tok', deviceToken: 'dev' }),
  wait = () => json({ status: 'pending' }, 202)
}: { needed?: boolean; login?: () => Response; wait?: () => Response } = {}) {
  localStorage.setItem('kl:serverUrl', SERVER);
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  fakeServer((url, init) => {
    if (url.pathname === '/api/auth/setup' && init?.method !== 'POST') return json({ needed });
    if (init?.method !== 'POST') return;
    posted.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
    return url.pathname === '/api/auth/login/wait' ? wait() : login();
  });
  return posted;
}

/// What a login gets while the account is locked against new devices.
const approval = (expiresIn = 600) =>
  json({ approval: { secret: 'sec', code: 'AB12CD', expiresIn } }, 202);

afterEach(() => {
  vi.useRealTimers();
});

/// Logs in while the account is locked, with timers under the test's control.
async function loginWhileLocked(options: Parameters<typeof server>[0]) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const posted = server(options);
  render(Login);
  await user.type(await screen.findByLabelText('username'), 'admin');
  await user.type(field('password'), 'hunter22{Enter}');
  await screen.findByRole('heading', { name: 'waiting for approval' });
  return { user, posted };
}

const field = (name: string) => screen.getByLabelText(name);

describe('the login screen', () => {
  it('logs in, then goes home', async () => {
    const user = userEvent.setup();
    const posted = server();
    render(Login);
    expect(await screen.findByRole('heading', { name: 'log in' })).toBeInTheDocument();
    expect(screen.getByText(SERVER)).toBeInTheDocument();
    await user.type(field('username'), 'admin');
    await user.type(field('password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'log in' }));
    await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/', { replaceState: true }));
    expect(posted).toEqual([
      {
        path: '/api/auth/login',
        body: expect.objectContaining({ username: 'admin', password: 'hunter22' })
      }
    ]);
  });

  it('logs in on Enter', async () => {
    const user = userEvent.setup();
    server();
    render(Login);
    await user.type(await screen.findByLabelText('username'), 'admin');
    await user.type(field('password'), 'hunter22{Enter}');
    await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/', { replaceState: true }));
  });

  it('says why it could not log in, and stays', async () => {
    const user = userEvent.setup();
    server({ login: () => json({ error: 'Wrong username or password' }, 401) });
    render(Login);
    await user.type(await screen.findByLabelText('username'), 'admin');
    await user.type(field('password'), 'nope{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password');
    expect(nav.goto).not.toHaveBeenCalled();
  });

  it('sets up a server that has no admin yet', async () => {
    const user = userEvent.setup();
    const posted = server({ needed: true });
    render(Login);
    expect(await screen.findByRole('heading', { name: 'set up the server' })).toBeInTheDocument();
    await user.type(field('setup token'), ' 0123abcd ');
    await user.type(field('username'), 'admin');
    await user.type(field('password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'create account' }));
    await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/', { replaceState: true }));
    expect(posted).toEqual([
      {
        path: '/api/auth/setup',
        body: expect.objectContaining({
          token: '0123abcd',
          username: 'admin',
          password: 'hunter22'
        })
      }
    ]);
  });

  it('gives the password rule when setting up', async () => {
    server({ needed: true });
    render(Login);
    expect(await screen.findByLabelText('password')).toHaveAccessibleDescription(
      'At least 8 characters.'
    );
  });

  it('asks for no setup token once set up', async () => {
    server();
    render(Login);
    await screen.findByRole('heading', { name: 'log in' });
    expect(screen.queryByLabelText('setup token')).not.toBeInTheDocument();
  });

  it("says when the server can't be reached, and tries again", async () => {
    const user = userEvent.setup();
    localStorage.setItem('kl:serverUrl', SERVER);
    render(Login);
    expect(await screen.findByRole('heading', { name: "can't reach the server" })).toBeVisible();
    server();
    await user.click(screen.getByRole('button', { name: 'try again' }));
    expect(await screen.findByRole('heading', { name: 'log in' })).toBeInTheDocument();
  });

  it('waits for a logged-in device to allow it, showing the code to match', async () => {
    const answers = [
      json({ status: 'pending' }, 202),
      json({ username: 'admin', token: 'tok2', deviceToken: 'dev2' })
    ];
    const { posted } = await loginWhileLocked({ login: approval, wait: () => answers.shift()! });
    expect(screen.getByLabelText('Code')).toHaveTextContent('AB12CD');
    await vi.advanceTimersByTimeAsync(3000);
    expect(nav.goto).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/', { replaceState: true }));
    expect(localStorage.getItem('kl:serverToken')).toBe('tok2');
    expect(posted.filter((p) => p.path === '/api/auth/login/wait')).toEqual([
      { path: '/api/auth/login/wait', body: { secret: 'sec' } },
      { path: '/api/auth/login/wait', body: { secret: 'sec' } }
    ]);
  });

  it('says when the login was denied, and goes back to the form', async () => {
    await loginWhileLocked({
      login: approval,
      wait: () => json({ error: 'The login was denied' }, 403)
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await screen.findByRole('alert')).toHaveTextContent('The login was denied.');
    expect(screen.getByRole('heading', { name: 'log in' })).toBeInTheDocument();
    expect(nav.goto).not.toHaveBeenCalled();
  });

  it('gives up once the approval has expired', async () => {
    const { posted } = await loginWhileLocked({ login: () => approval(5) });
    await vi.advanceTimersByTimeAsync(6000);
    expect(await screen.findByRole('alert')).toHaveTextContent('No one allowed it in time');
    const asked = posted.length;
    await vi.advanceTimersByTimeAsync(9000);
    expect(posted).toHaveLength(asked);
  });

  it('stops waiting on cancel', async () => {
    const { user, posted } = await loginWhileLocked({ login: approval });
    await user.click(screen.getByRole('button', { name: 'cancel' }));
    expect(screen.getByRole('heading', { name: 'log in' })).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(9000);
    expect(posted.filter((p) => p.path === '/api/auth/login/wait')).toHaveLength(0);
  });

  it('sends the app to Settings without a server', async () => {
    const user = userEvent.setup();
    render(Login);
    expect(screen.getByRole('heading', { name: 'no server' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'settings' }));
    expect(nav.goto).toHaveBeenCalledWith('/settings');
  });
});
