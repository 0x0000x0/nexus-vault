import { useRef, useEffect, useState } from 'react';
import { LogoIcon, VaultIcon, ViewIcons, ThemeIcons, SearchIcon, SettingsIcon, HelpIcon, MaximizeIcon, SwapIcon } from './icons';

interface TitleBarProps {
  currentVault: { name: string; path: string; type: 'copy' | 'real' } | null;
  recentVaults: Array<{ name: string; path: string; type: 'copy' | 'real'; lastOpened: number; exists: boolean }>;
  theme: 'light' | 'dark' | 'system';
  systemTheme: 'light' | 'dark';
  view: 'graph' | 'split' | 'board';
  paneOrder: 'board-graph' | 'graph-board';
  onOpenVault: (path: string, type: 'copy' | 'real') => void;
  onSafeCopy: (sourcePath: string) => Promise<void>;
  onCloseVault: () => void;
  onRemoveRecent: (path: string) => void;
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
  onViewChange: (view: 'graph' | 'split' | 'board') => void;
  onPaneOrderChange: () => void;
  onSafeCopyClick: () => void;
}

export function TitleBar({
  currentVault,
  recentVaults,
  theme,
  systemTheme,
  view,
  paneOrder,
  onOpenVault,
  onSafeCopy,
  onCloseVault,
  onRemoveRecent,
  onThemeChange,
  onViewChange,
  onPaneOrderChange,
}: TitleBarProps) {
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const vaultChipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (vaultChipRef.current && !vaultChipRef.current.contains(e.target as Node)) {
        setVaultMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleOpenFolder = async () => {
    const result = await window.nexus.ipc.invoke('renderer:open-folder-dialog' as any, {});
    if (result?.path) {
      const confirmed = await window.nexus.ipc.invoke('renderer:confirm-dialog' as any, {
        title: 'Open Real Vault',
        message: 'This will open the actual vault folder. M0 is read-only, but future versions may write. Make a safe copy instead?',
        buttons: ['Open Real Vault', 'Make Safe Copy', 'Cancel'],
      });
      if (confirmed === 0) {
        onOpenVault(result.path, 'real');
      } else if (confirmed === 1) {
        onSafeCopy(result.path);
      }
    }
  };

  const handleSafeCopy = async () => {
    const result = await window.nexus.ipc.invoke('renderer:open-folder-dialog' as any, {});
    if (result?.path) {
      await onSafeCopy(result.path);
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

  const effectiveTheme = theme === 'system' ? systemTheme : theme;

  return (
    <header className="titlebar">
      <div className="brand">
        <LogoIcon />
        Nexus Vault
      </div>

      <div className="chip" ref={vaultChipRef} onClick={() => setVaultMenuOpen(!vaultMenuOpen)}>
        <VaultIcon />
        <span>{currentVault ? currentVault.name : 'No vault open'}</span>
        <span className="caret">{vaultMenuOpen ? '▲' : '▼'}</span>
        <div className="vaultmenu">
          {currentVault && (
            <div className="vi cur" onClick={() => onCloseVault()}>
              ✓ Close vault
            </div>
          )}
          {recentVaults.map((v, i) => (
            <div key={v.path} className="vi" onClick={() => handleRecentClick(v)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {v.type === 'copy' && <span style={{ fontSize: 10, background: 'var(--accent-soft)', color: 'var(--accent)', padding: '1px 4px', borderRadius: 4 }}>copy</span>}
                {v.name}
              </span>
              <small>{v.path}</small>
              {!v.exists && <span style={{ color: 'var(--faint)', marginLeft: 'auto' }}>not found</span>}
              <button onClick={(e) => handleRemoveRecent(e, v.path)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--faint)', cursor: 'pointer', fontSize: 12 }}>✕</button>
            </div>
          ))}
          <div className="sep" />
          <div className="vi" onClick={handleSafeCopy}>📂 Open safe copy…</div>
          <div className="vi" onClick={handleOpenFolder}>📁 Open folder as vault…</div>
        </div>
      </div>

      <div className="seg" id="viewSeg">
        <button data-view="graph" className={view === 'graph' ? 'on' : ''} onClick={() => onViewChange('graph')}>
          <ViewIcons.Graph /> Graph
        </button>
        <button data-view="split" className={view === 'split' ? 'on' : ''} onClick={() => onViewChange('split')}>
          <ViewIcons.Split /> Side-by-side
        </button>
        <button data-view="board" className={view === 'board' ? 'on' : ''} onClick={() => onViewChange('board')}>
          <ViewIcons.Board /> Board
        </button>
      </div>

      <div className="search" title="Search (coming soon)">
        <SearchIcon />
        Search or run a command…
        <span className="kbd">Ctrl K</span>
      </div>

      <div className="spacer" />

      <div className="seg" id="themeSeg" title="Theme">
        <button data-theme="light" className={theme === 'light' ? 'on' : ''} onClick={() => onThemeChange('light')}>
          <ThemeIcons.Light /> Light
        </button>
        <button data-theme="dark" className={theme === 'dark' ? 'on' : ''} onClick={() => onThemeChange('dark')}>
          <ThemeIcons.Dark /> Dark
        </button>
        <button data-theme="system" className={theme === 'system' ? 'on' : ''} onClick={() => onThemeChange('system')}>
          <ThemeIcons.System /> System
        </button>
      </div>

      <button className="iconbtn" title="Settings" onClick={() => window.nexus.ipc.invoke('renderer:open-settings' as any, {})}>
        <SettingsIcon />
      </button>
      <button className="iconbtn" title="Help">
        <HelpIcon />
      </button>
    </header>
  );
}