import { invoke } from '@tauri-apps/api/core';
import { GITHUB_REPO } from './update';

/// The app's logs, oldest first, under its version and platform.
export const readLogs = () => invoke<string>('read_logs');

/// The last session's crash, if it had one. Asking clears it.
export const takeCrashReport = () => invoke<string | null>('take_crash_report');

/// GitHub turns away issue links much past 8 KB.
const MAX_URL = 7500;

/// A new GitHub issue holding the crash and as much of the end of the logs as
/// fits in the link. Nothing is sent: the reporter sees it all and submits it.
export function crashIssueUrl(crash: string, logs: string): string {
  const base = `https://github.com/${GITHUB_REPO}/issues/new?title=${encodeURIComponent('Crash report')}&body=`;
  const url = (body: string) => base + encodeURIComponent(body);
  const withLogs = (lines: string[]) =>
    `${crash.trim()}\n\nEnd of the logs:\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`;

  const lines = logs.trimEnd().split('\n');
  for (let from = 0; from < lines.length; from++) {
    const candidate = url(withLogs(lines.slice(from)));
    if (candidate.length <= MAX_URL) return candidate;
  }
  let text = crash.trim();
  while (url(text).length > MAX_URL) text = text.slice(0, -100);
  return url(text);
}

// Matches tauri-plugin-log's LogLevel.
const LOG_ERROR = 5;

/// Sends the page's uncaught errors to the app's log. Returns the way back.
export function logWebviewErrors(): () => void {
  const log = (message: string) =>
    invoke('plugin:log|log', { level: LOG_ERROR, message }).catch(() => {});
  const onError = (e: ErrorEvent) =>
    log(`${e.message} (${e.filename || 'unknown'}:${e.lineno}:${e.colno})`);
  const onRejection = (e: PromiseRejectionEvent) =>
    log(
      `Unhandled rejection: ${e.reason instanceof Error ? e.reason.stack || e.reason.message : String(e.reason)}`
    );
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
