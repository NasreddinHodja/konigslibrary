import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import ShareLan from './ShareLan.svelte';
import { mockApp } from '$lib/testing/tauri';

const URL = 'http://192.168.1.5:41000';

const status = (setupNeeded: boolean) => ({ running: true, url: URL, port: 41000, setupNeeded });

/// The app, whose server needs setting up until `setup_lan_server` succeeds;
/// `setup` answers that command.
function app(setup: (args: unknown) => unknown = () => status(false)) {
  return mockApp((cmd, args) => {
    if (cmd === 'lan_server_status')
      return { running: false, url: null, port: null, setupNeeded: false };
    if (cmd === 'start_lan_server') return status(true);
    if (cmd === 'setup_lan_server') return setup(args);
  });
}

describe('share to LAN', () => {
  beforeEach(() => localStorage.setItem('kl:nativeMangaDir', '/home/me/Manga'));

  it('asks for the account the first time, then shows the address', async () => {
    const calls = app();
    const user = userEvent.setup();
    render(ShareLan);
    await user.click(screen.getByRole('button', { name: 'share to lan' }));
    expect(screen.queryByText(URL)).not.toBeInTheDocument();

    await user.type(await screen.findByRole('textbox', { name: 'Username' }), 'admin');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'create account' }));

    expect(await screen.findByText(URL)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Username' })).not.toBeInTheDocument();
    expect(calls.find((c) => c.cmd === 'setup_lan_server')?.args).toEqual({
      username: 'admin',
      password: 'correct horse'
    });
  });

  it("says why the account wasn't created, and keeps the form", async () => {
    app(() => {
      throw 'The password needs at least 8 characters';
    });
    const user = userEvent.setup();
    render(ShareLan);
    await user.click(screen.getByRole('button', { name: 'share to lan' }));
    await user.type(await screen.findByRole('textbox', { name: 'Username' }), 'admin');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The password needs at least 8 characters'
    );
    expect(screen.getByRole('textbox', { name: 'Username' })).toBeInTheDocument();
    expect(screen.queryByText(URL)).not.toBeInTheDocument();
  });

  it('shows the address at once on a server already set up', async () => {
    mockApp((cmd) => {
      if (cmd === 'lan_server_status') return status(false);
    });
    render(ShareLan);
    expect(await screen.findByText(URL)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'copy' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Username' })).not.toBeInTheDocument();
  });

  describe('a forgotten password', () => {
    /// Sharing, with the account made; the reset brings back a fresh server.
    function shared() {
      return mockApp((cmd) => {
        if (cmd === 'lan_server_status') return status(false);
        if (cmd === 'start_lan_server') return status(true);
      });
    }

    it('resets the account after asking, then asks for a new one', async () => {
      const calls = shared();
      const user = userEvent.setup();
      render(ShareLan);
      await user.click(await screen.findByRole('button', { name: 'forgot the password?' }));
      await user.click(screen.getByRole('button', { name: 'reset' }));

      expect(await screen.findByRole('textbox', { name: 'Username' })).toBeInTheDocument();
      expect(calls.map((c) => c.cmd)).toEqual([
        'lan_server_status',
        'reset_lan_account',
        'start_lan_server'
      ]);
    });

    it('is left alone when the question is cancelled', async () => {
      const calls = shared();
      const user = userEvent.setup();
      render(ShareLan);
      await user.click(await screen.findByRole('button', { name: 'forgot the password?' }));
      await user.click(screen.getByRole('button', { name: 'cancel' }));

      expect(screen.getByText(URL)).toBeInTheDocument();
      expect(calls.map((c) => c.cmd)).not.toContain('reset_lan_account');
    });
  });
});
