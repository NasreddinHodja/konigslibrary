import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Settings from './+page.svelte';
import { fakeServer, json } from '$lib/testing/server';

// The local build (LOCAL_BUILD), served by konigslibrary-server, which keeps
// the manga directory: a build flag, so set here for the whole file.
vi.mock('$lib/utils/constants', async (original) => ({
  ...(await original<typeof import('$lib/utils/constants')>()),
  isLocalServer: true
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { state: {} } }));

const dirBox = () => screen.getByPlaceholderText('/path/to/manga');

/// The server's settings endpoint, holding `dir`; saving can be made to fail.
/// Returns what was saved.
function settingsServer(dir: string, { saveFails = false } = {}) {
  const saved: unknown[] = [];
  fakeServer((url, init) => {
    if (url.pathname !== '/api/settings') return;
    if (init?.method !== 'POST') return json({ mangaDir: dir });
    saved.push(JSON.parse(String(init.body)));
    return new Response('', { status: saveFails ? 500 : 200 });
  });
  return saved;
}

describe('settings of the local server', () => {
  it('starts with the library, then the server', () => {
    settingsServer('/srv/manga');
    render(Settings);
    const jumps = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('#'));
    expect(jumps.map((a) => a.textContent?.trim())).toEqual(['› library', '› server', '› theme']);
  });

  it('has the account but no address to connect to', async () => {
    fakeServer((url) => (url.pathname === '/api/auth/me' ? json({ username: 'ann' }) : undefined));
    render(Settings);
    expect(await screen.findByText('ann')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Server URL' })).not.toBeInTheDocument();
  });

  it("shows the server's manga directory", async () => {
    settingsServer('/srv/manga');
    render(Settings);
    await vi.waitFor(() => expect(dirBox()).toHaveValue('/srv/manga'));
  });

  it('saves a new one', async () => {
    const user = userEvent.setup();
    const saved = settingsServer('/srv/manga');
    render(Settings);
    await vi.waitFor(() => expect(dirBox()).toHaveValue('/srv/manga'));
    await user.clear(dirBox());
    await user.type(dirBox(), '/mnt/comics');
    await user.click(screen.getByRole('button', { name: 'save' }));
    expect(await screen.findByText('Saved - reload to see library')).toBeInTheDocument();
    expect(saved).toEqual([{ mangaDir: '/mnt/comics' }]);
  });

  it('says when saving fails', async () => {
    const user = userEvent.setup();
    settingsServer('/srv/manga', { saveFails: true });
    render(Settings);
    await vi.waitFor(() => expect(dirBox()).toHaveValue('/srv/manga'));
    await user.click(screen.getByRole('button', { name: 'save' }));
    expect(await screen.findByText('Failed to save settings')).toBeInTheDocument();
    expect(screen.queryByText('Saved - reload to see library')).not.toBeInTheDocument();
  });

  it('says when the settings cannot be loaded', async () => {
    fakeServer(() => new Response('', { status: 403 }));
    render(Settings);
    expect(await screen.findByText('Could not load settings')).toBeInTheDocument();
  });
});
