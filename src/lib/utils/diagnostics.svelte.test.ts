import { describe, it, expect } from 'vitest';
import { crashIssueUrl, logWebviewErrors } from './diagnostics';
import { mockApp } from '$lib/testing/tauri';

const body = (url: string) => new URL(url).searchParams.get('body')!;

describe('the crash issue link', () => {
  it('opens a new issue on the repository with the crash and the logs', () => {
    const url = crashIssueUrl('panicked at x.rs:1:1:\nboom\n', 'first\nlast\n');
    expect(url).toMatch(/^https:\/\/github\.com\/NasreddinHodja\/konigslibrary\/issues\/new\?/);
    expect(new URL(url).searchParams.get('title')).toBe('Crash report');
    expect(body(url)).toBe(
      'panicked at x.rs:1:1:\nboom\n\nEnd of the logs:\n```\nfirst\nlast\n```\n'
    );
  });

  it('keeps the end of long logs and stays short enough for GitHub', () => {
    const logs = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
    const url = crashIssueUrl('boom', logs);
    expect(url.length).toBeLessThanOrEqual(7500);
    expect(body(url)).toContain('boom');
    expect(body(url)).toContain('line 1999\n```');
    expect(body(url)).not.toContain('line 0\n');
  });

  it('cuts a crash too long on its own', () => {
    const url = crashIssueUrl('x'.repeat(20000), 'log');
    expect(url.length).toBeLessThanOrEqual(7500);
    expect(body(url)).toMatch(/^x+$/);
  });
});

describe("the page's errors", () => {
  it('go to the log, until let go', () => {
    const calls = mockApp();
    const stop = logWebviewErrors();
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'oops', filename: 'app.js', lineno: 3, colno: 7 })
    );
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: 'nope' });
    window.dispatchEvent(rejection);
    stop();
    window.dispatchEvent(new ErrorEvent('error', { message: 'after' }));

    expect(calls.filter((c) => c.cmd === 'plugin:log|log').map((c) => c.args)).toEqual([
      { level: 5, message: 'oops (app.js:3:7)' },
      { level: 5, message: 'Unhandled rejection: nope' }
    ]);
  });
});
