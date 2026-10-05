import { useState, useEffect } from 'react';
import { LogoIcon, FolderIcon, NewNoteIcon, NewFolderIcon, CollapseAllIcon } from './icons';
import { nexus } from '../utils/nexus';

interface VaultPickerProps {
  onOpenVault: (path: string, type: 'copy' | 'real') => void;
  onSafeCopy: (sourcePath: string) => Promise<void>;
  recentVaults: Array<{ name: string; path: string; type: 'copy' | 'real'; lastOpened: number; exists: boolean }>;
  onRemoveRecent: (path: string) => void;
}

export function VaultPicker({ onOpenVault, onSafeCopy, recentVaults, onRemoveRecent }: VaultPickerProps) {
  const [copyProgress, setCopyProgress] = useState<{ active: boolean; path?: string; bytes?: number; total?: number }>({ active: false });

  useEffect(() => {
    const unsub = nexus.noteCount.onProgress((progress) => {
      // Note count progress handled elsewhere
    });
    return unsub;
  }, []);

  const handleOpenFolder = async () => {
    const result = await nexus.ipc.invoke('renderer:open-folder-dialog' as any, {});
    if (result?.path) {
      const confirmed = await nexus.ipc.invoke('renderer:confirm-dialog' as any, {
        title: 'Open Real Vault',
        message: 'This will open the actual vault folder. M0 is read-only, but future versions may write. Make a safe copy instead?',
        buttons: ['Open Real Vault', 'Make Safe Copy', 'Cancel'],
      });
      if (confirmed === 0) {
        onOpenVault(result.path, 'real');
      } else if (confirmed === 1) {
        await onSafeCopy(result.path);
      }
    }
  };

  const handleSafeCopy = async () => {
    const result = await nexus.ipc.invoke('renderer:open-folder-dialog' as any, {});
    if (result?.path) {
      setCopyProgress({ active: true, path: result.path });
      const copyResult = await onSafeCopy(result.path);
      setCopyProgress({ active: false });
    }
  };

  const handleRecentClick = (vault: typeof recentVaults[0]) => {
    if (vault.exists) {
      onOpenVault(vault.path, vault.type);
    }
  };

  const handleRemoveRecent = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    onRemoveRecent(path);
  };

  return (
    <div className="welcome" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40 }}>
      <LogoIcon />
      <h2 style={{ margin: '20px 0 10px', fontSize: 22 }}>Welcome to Nexus Vault</h2>
      <p style={{ color: 'var(--muted)', textAlign: 'center', maxWidth: 360, marginBottom: 30 }}>
        A vault is just a folder of notes on your PC. Open your Obsidian vault (we suggest a safe copy first) or create a new one.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 360 }}>
        <button className="btn primary" style={{ padding: '12px 16px', fontSize: 14 }} onClick={handleSafeCopy}>
          Open a safe copy of a vault (recommended)
        </button>
        <button className="btn" style={{ padding: '12px 16px', fontSize: 14 }} onClick={handleOpenFolder}>
          Open folder as vault…
        </button>
      </div>

      {copyProgress.active && (
        <div style={{ marginTop: 20, padding: 16, background: 'var(--panel)', borderRadius: 8, width: '100%', maxWidth: 360 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Creating safe copy…</div>
          <div style={{ fontSize: 11, color: 'var(--faint)', wordBreak: 'break-all' }}>{copyProgress.path}</div>
        </div>
      )}

      {recentVaults.length > 0 && (
        <div style={{ marginTop: 30, width: '100%', maxWidth: 360 }}>
          <h4 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 12 }}>
            Recent vaults
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {recentVaults.map((v) => (
              <div
                key={v.path}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: v.exists ? 'var(--card)' : 'var(--panel)',
                  border: '1px solid var(--border)',
                  opacity: v.exists ? 1 : 0.5,
                }}
                onClick={() => handleRecentClick(v)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 500 }}>{v.name}</span>
                    {v.type === 'copy' && (
                      <span style={{ fontSize: 10, background: 'var(--accent-soft)', color: 'var(--accent)', padding: '1px 6px', borderRadius: 4 }}>copy</span>
                    )}
                  </div>
                  <small style={{ color: 'var(--faint)' }}>{v.path}</small>
                  {!v.exists && <span style={{ color: 'var(--c-red)', fontSize: 11 }}>not found</span>}
                </div>
                <button
                  onClick={(e) => handleRemoveRecent(e, v.path)}
                  style={{ background: 'none', border: 'none', color: 'var(--faint)', cursor: 'pointer', padding: 4, fontSize: 14 }}
                  title="Remove from list"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}