import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import type { InvokeArgs } from '@tauri-apps/api/core';

export type IpcCall = { cmd: string; args?: InvokeArgs };

/// Runs the page as the Tauri app: one window, and `handle` answering its
/// commands. Returns every command called, in order.
export function mockApp(handle: (cmd: string, args?: InvokeArgs) => unknown = () => {}) {
  const calls: IpcCall[] = [];
  mockWindows('main');
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      return handle(cmd, args);
    },
    // Event listeners too (deep links, window events), so they can be undone.
    { shouldMockEvents: true }
  );
  return calls;
}
