export const Channels = {
  'renderer:open-vault': { payload: { path: string; type: 'copy' | 'real' } },
  'renderer:close-vault': { payload: void },
  'renderer:get-recent-vaults': { payload: void; return: VaultInfo[] },
  'renderer:remove-recent-vault': { payload: string },
  'renderer:safe-copy-vault': { payload: { sourcePath: string }; return: SafeCopyResult },
  'renderer:list-dir': { payload: { vaultRoot: string; relPath: string }; return: DirEntry[] },
  'renderer:read-file': { payload: { vaultRoot: string; relPath: string }; return: string },
  'renderer:get-settings': { payload: void; return: Settings },
  'renderer:save-settings': { payload: Partial<Settings> },
  'main:theme-changed': { payload: 'light' | 'dark' | 'system' },
  'main:note-count-progress': { payload: NoteCountProgress },
  'main:safe-copy-progress': { payload: { bytesCopied: number; totalBytes: number } },
} as const;

export type ChannelName = keyof typeof Channels;

export type Payload<T extends ChannelName> = typeof Channels[T]['payload'];
export type ReturnType<T extends ChannelName> = typeof Channels[T] extends { return: infer R } ? R : never;

import type { VaultInfo, DirEntry, SafeCopyResult, Settings, NoteCountProgress, LayoutSettings } from './vault.js';