import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import AccountSettings from './AccountSettings.svelte';
import { fakeServer, json } from '$lib/testing/server';
import { getToasts } from '$lib/ui/toast.svelte';
import type { Session, WaitingLogin } from '$lib/api/auth.svelte';

const nav = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: nav.goto }));

const session = (id: string, device: string, current = false): Session => ({
  id,
  device,
  created: 1_700_000_000,
  lastSeen: 1_700_000_000,
  current
});

type Handler = (url: URL, init?: RequestInit) => Response | undefined;

/// The server, logged in as admin with these sessions; `extra` answers the
/// rest. Returns each request's method and path.
function server(sessions: Session[], extra: Handler = () => undefined) {
  localStorage.setItem('kl:serverUrl', 'http://192.168.1.5:3000');
  localStorage.setItem('kl:serverToken', 'tok');
  const requests: string[] = [];
  fakeServer((url, init) => {
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    const answer = extra(url, init);
    if (answer) return answer;
    if (url.pathname === '/api/auth/me') return json({ username: 'admin', session: 'a' });
    if (url.pathname === '/api/auth/sessions') return json(sessions);
  });
  return requests;
}

const devices = () => screen.findByRole('list', { name: 'Logged-in devices' });

const tablet: WaitingLogin = {
  id: 'w1',
  code: 'AB12CD',
  device: 'Tablet',
  address: '203.0.113.7',
  created: 1_700_000_000
};

/// The server with `waiting` logins, answering decisions on them; returns
/// each decision's path and body.
function serverWithWaiting(waiting: () => WaitingLogin[]) {
  const decisions: { path: string; body: unknown }[] = [];
  server([session('a', 'This phone', true)], (url, init) => {
    if (url.pathname === '/api/auth/approvals') return json(waiting());
    if (!url.pathname.startsWith('/api/auth/approvals/')) return;
    decisions.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: 204 });
  });
  return decisions;
}

const waitingList = () => screen.findByRole('list', { name: 'Waiting to log in' });

afterEach(() => {
  vi.useRealTimers();
});

describe('account settings', () => {
  it('say who is logged in', async () => {
    server([]);
    render(AccountSettings);
    expect(await screen.findByText('admin')).toBeInTheDocument();
    expect(screen.getByText(/Logged in as/)).toHaveTextContent('Logged in as admin');
  });

  it('offer to log in when no one is', async () => {
    const user = userEvent.setup();
    server([], (url) =>
      url.pathname === '/api/auth/me' ? json({ error: 'Unauthorized' }, 401) : undefined
    );
    render(AccountSettings);
    expect(await screen.findByText('Not logged in.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(nav.goto).toHaveBeenCalledWith('/login');
  });

  it('log out', async () => {
    const user = userEvent.setup();
    const requests = server([], (url) =>
      url.pathname === '/api/auth/logout' ? new Response(null, { status: 204 }) : undefined
    );
    render(AccountSettings);
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/login'));
    expect(requests).toContain('POST /api/auth/logout');
    expect(localStorage.getItem('kl:serverToken')).toBeNull();
  });

  it('list the logged-in devices, this one marked', async () => {
    server([session('a', 'This phone', true), session('b', 'Firefox')]);
    render(AccountSettings);
    const items = await within(await devices()).findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('This phone');
    expect(items[0]).toHaveTextContent('This device');
    expect(within(items[0]).queryByRole('button')).not.toBeInTheDocument();
    expect(items[1]).toHaveTextContent('Firefox');
    expect(items[1]).toHaveTextContent(/Last used/);
  });

  it('log another device out', async () => {
    const user = userEvent.setup();
    const requests = server([session('a', 'This phone', true), session('b', 'Firefox')], (url) =>
      url.pathname === '/api/auth/sessions/b' ? new Response(null, { status: 204 }) : undefined
    );
    render(AccountSettings);
    await devices();
    await user.click(await screen.findByRole('button', { name: 'Log out Firefox' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Log out Firefox' })).not.toBeInTheDocument()
    );
    expect(requests).toContain('DELETE /api/auth/sessions/b');
    expect(screen.getByText('This phone')).toBeInTheDocument();
  });

  it("say when a device couldn't be logged out", async () => {
    const user = userEvent.setup();
    server([session('a', 'This phone', true), session('b', 'Firefox')], (url) =>
      url.pathname === '/api/auth/sessions/b' ? json({ error: 'No such session' }, 404) : undefined
    );
    render(AccountSettings);
    await user.click(await screen.findByRole('button', { name: 'Log out Firefox' }));
    await vi.waitFor(() => expect(getToasts().map((t) => t.label)).toContain('No such session'));
    expect(screen.getByRole('button', { name: 'Log out Firefox' })).toBeInTheDocument();
  });

  it('change the password, then list the devices still logged in', async () => {
    const user = userEvent.setup();
    let sessions = [session('a', 'This phone', true), session('b', 'Firefox')];
    const changed: unknown[] = [];
    server([], (url, init) => {
      if (url.pathname === '/api/auth/sessions') return json(sessions);
      if (url.pathname !== '/api/auth/password') return;
      changed.push(JSON.parse(String(init?.body)));
      sessions = sessions.filter((s) => s.current);
      return new Response(null, { status: 204 });
    });
    render(AccountSettings);
    await screen.findByText('Firefox');
    await user.type(screen.getByLabelText('Current password'), 'hunter22');
    await user.type(screen.getByLabelText('New password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await vi.waitFor(() => expect(screen.queryByText('Firefox')).not.toBeInTheDocument());
    expect(changed).toEqual([{ currentPassword: 'hunter22', newPassword: 'correct horse' }]);
    expect(getToasts().map((t) => t.label)).toContain(
      'Password changed; other devices are logged out'
    );
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  it("say why the password wasn't changed", async () => {
    const user = userEvent.setup();
    server([], (url) =>
      url.pathname === '/api/auth/password'
        ? json({ error: 'Wrong current password' }, 403)
        : undefined
    );
    render(AccountSettings);
    await user.type(await screen.findByLabelText('Current password'), 'nope');
    await user.type(screen.getByLabelText('New password'), 'correct horse{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong current password');
    expect(screen.getByLabelText('New password')).toHaveValue('correct horse');
  });

  it('list logins waiting for approval, with the code to match', async () => {
    serverWithWaiting(() => [tablet]);
    render(AccountSettings);
    const [item] = await within(await waitingList()).findAllByRole('listitem');
    expect(item).toHaveTextContent('Tablet');
    expect(item).toHaveTextContent('AB12CD');
    expect(item).toHaveTextContent('203.0.113.7');
  });

  it('allow a waiting login', async () => {
    const user = userEvent.setup();
    const decisions = serverWithWaiting(() => [tablet]);
    render(AccountSettings);
    await user.click(await screen.findByRole('button', { name: 'Allow Tablet, code AB12CD' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Waiting to log in' })).not.toBeInTheDocument()
    );
    expect(decisions).toEqual([{ path: '/api/auth/approvals/w1', body: { allow: true } }]);
    expect(getToasts().map((t) => t.label)).toContain('Tablet is logged in');
  });

  it('deny a waiting login', async () => {
    const user = userEvent.setup();
    const decisions = serverWithWaiting(() => [tablet]);
    render(AccountSettings);
    const deny = await screen.findByRole('button', { name: 'Deny Tablet, code AB12CD' });
    const before = getToasts().length;
    await user.click(deny);
    await vi.waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Waiting to log in' })).not.toBeInTheDocument()
    );
    expect(decisions).toEqual([{ path: '/api/auth/approvals/w1', body: { allow: false } }]);
    expect(getToasts().slice(before)).toEqual([]);
  });

  it('show a login that starts waiting while open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let waiting: WaitingLogin[] = [];
    serverWithWaiting(() => waiting);
    render(AccountSettings);
    await devices();
    expect(screen.queryByRole('list', { name: 'Waiting to log in' })).not.toBeInTheDocument();
    waiting = [tablet];
    await vi.advanceTimersByTimeAsync(5000);
    expect(await waitingList()).toHaveTextContent('Tablet');
  });
});
