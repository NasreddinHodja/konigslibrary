import { invoke } from '@tauri-apps/api/core';

export type LanServerStatus = {
  running: boolean;
  url: string | null;
  port: number | null;
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
