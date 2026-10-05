import { invoke } from '@tauri-apps/api/core';

export type LanServerStatus = {
  running: boolean;
  url: string | null;
  port: number | null;
  /// No admin yet: other devices have no account to log in with.
  setupNeeded: boolean;
};

export async function startLanServer(mangaDir: string): Promise<LanServerStatus> {
  return invoke('start_lan_server', { mangaDir, port: null });
}

export async function stopLanServer(): Promise<void> {
  return invoke('stop_lan_server');
}

export async function getLanServerStatus(): Promise<LanServerStatus> {
  return invoke('lan_server_status');
}

/// Creates the account other devices log in with, on the running server.
export async function setupLanServer(username: string, password: string): Promise<LanServerStatus> {
  return invoke('setup_lan_server', { username, password });
}

/// Forgets that account and stops the server; sharing again asks for a new one.
export async function resetLanAccount(): Promise<void> {
  return invoke('reset_lan_account');
}
