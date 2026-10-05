import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Login from './+page.svelte';
import { fakeServer, json } from '$lib/testing/server';

const nav = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: nav.goto }));

const SERVER = 'http://192.168.1.5:3000';

/// The server: set up or not, and answering logins with `login`. Returns
/// each request's path and body.
function server({
  needed = false,
  login = () => json({ username: 'admin', token: 'tok', deviceToken: 'dev' })
}: { needed?: boolean; login?: () => Response } = {}) {
  localStorage.setItem('kl:serverUrl', SERVER);
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  fakeServer((url, init) => {
    if (url.pathname === '/api/auth/setup' && init?.method !== 'POST') return json({ needed });
    if (init?.method !== 'POST') return;
    posted.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
    return login();
  });
  return posted;
}

const field = (name: string) => screen.getByLabelText(name);

describe('the login screen', () => {
  it('logs in, then goes home', async () => {
    const user = userEvent.setup();
    const posted = server();
    render(Login);
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByText(SERVER)).toBeInTheDocument();
    await user.type(field('Username'), 'admin');
    await user.type(field('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
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
    await user.type(await screen.findByLabelText('Username'), 'admin');
    await user.type(field('Password'), 'hunter22{Enter}');
    await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/', { replaceState: true }));
  });

  it('says why it could not log in, and stays', async () => {
    const user = userEvent.setup();
    server({ login: () => json({ error: 'Wrong username or password' }, 401) });
    render(Login);
    await user.type(await screen.findByLabelText('Username'), 'admin');
    await user.type(field('Password'), 'nope{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password');
    expect(nav.goto).not.toHaveBeenCalled();
  });

  it('sets up a server that has no admin yet', async () => {
    const user = userEvent.setup();
    const posted = server({ needed: true });
    render(Login);
    expect(await screen.findByRole('heading', { name: 'Set up the server' })).toBeInTheDocument();
    await user.type(field('Setup token'), ' 0123abcd ');
    await user.type(field('Username'), 'admin');
    await user.type(field('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
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
    expect(await screen.findByLabelText('Password')).toHaveAccessibleDescription(
      'At least 8 characters.'
    );
  });

  it('asks for no setup token once set up', async () => {
    server();
    render(Login);
    await screen.findByRole('heading', { name: 'Log in' });
    expect(screen.queryByLabelText('Setup token')).not.toBeInTheDocument();
  });

  it("says when the server can't be reached, and tries again", async () => {
    const user = userEvent.setup();
    localStorage.setItem('kl:serverUrl', SERVER);
    render(Login);
    expect(await screen.findByRole('heading', { name: "Can't reach the server" })).toBeVisible();
    server();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('sends the app to Settings without a server', async () => {
    const user = userEvent.setup();
    render(Login);
    expect(screen.getByRole('heading', { name: 'No server' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(nav.goto).toHaveBeenCalledWith('/settings');
  });
});
