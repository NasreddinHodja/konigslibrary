import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import CrashReport from './CrashReport.svelte';
import { getToasts } from './toast.svelte';
import { mockApp } from '$lib/testing/tauri';

/// The app, with `crash` left by the last session and `logs` on disk.
function app(crash: string | null, logs = 'log line 42') {
  return mockApp((cmd) => {
    if (cmd === 'take_crash_report') return crash;
    if (cmd === 'read_logs') return logs;
  });
}

const dialog = () => screen.findByRole('dialog', { name: 'Crash report' });

describe('the crash report', () => {
  it('is not offered without a crash', async () => {
    const calls = app(null);
    render(CrashReport);
    await new Promise((r) => setTimeout(r));
    expect(calls.map((c) => c.cmd)).toContain('take_crash_report');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a GitHub issue with the crash and the logs', async () => {
    const user = userEvent.setup();
    const calls = app('boom');
    render(CrashReport);
    await user.click(await screen.findByRole('button', { name: 'Report' }));

    const open = calls.find((c) => c.cmd === 'plugin:opener|open_url');
    const url = new URL((open?.args as { url: string }).url);
    expect(url.pathname).toBe('/NasreddinHodja/konigslibrary/issues/new');
    expect(url.searchParams.get('body')).toContain('boom');
    expect(url.searchParams.get('body')).toContain('log line 42');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reports the crash alone when the logs never come', async () => {
    const user = userEvent.setup();
    const calls = mockApp((cmd) => {
      if (cmd === 'take_crash_report') return 'boom';
      if (cmd === 'read_logs') return new Promise(() => {});
    });
    render(CrashReport);
    await user.click(await screen.findByRole('button', { name: 'Report' }));
    await vi.waitFor(() => expect(calls.map((c) => c.cmd)).toContain('plugin:opener|open_url'), {
      timeout: 2000
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('copies the crash and the logs', async () => {
    const user = userEvent.setup();
    app('boom');
    render(CrashReport);
    await user.click(await screen.findByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe('boom\n\nlog line 42');
    expect(getToasts().map((t) => t.label)).toContain('Crash report copied');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('copies through the Android app', async () => {
    const user = userEvent.setup();
    const copyText = vi.fn();
    (window as { __kl?: unknown }).__kl = { copyText };
    await navigator.clipboard.writeText('before');
    await navigator.clipboard.writeText('before');
    app('boom');
    render(CrashReport);
    await user.click(await screen.findByRole('button', { name: 'Copy' }));
    await vi.waitFor(() => expect(copyText).toHaveBeenCalledWith('boom\n\nlog line 42'));
    delete (window as { __kl?: unknown }).__kl;
    expect(await navigator.clipboard.readText()).toBe('before');
  });

  it('sends nothing when dismissed', async () => {
    const user = userEvent.setup();
    const calls = app('boom');
    render(CrashReport);
    expect(await dialog()).toHaveTextContent('konigslibrary crashed last time');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.map((c) => c.cmd)).not.toContain('plugin:opener|open_url');
  });
});
