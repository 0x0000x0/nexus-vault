import { useEffect, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { VaultPicker } from './components/VaultPicker';
import { FolderTree } from './components/FolderTree';
import { ToolStrip } from './components/ToolStrip';
import { MainArea } from './components/MainArea';
import { StatusBar } from './components/StatusBar';
import { useVault } from './hooks/useVault';
import { useTheme } from './hooks/useTheme';
import { useLayout } from './hooks/useLayout';
import { nexus } from './utils/nexus';

function App() {
  const { currentVault, openVault, closeVault, recentVaults, safeCopyVault, removeRecentVault } = useVault();
  const { theme, setTheme, systemTheme } = useTheme();
  const { layout, setLayout, resetDivider } = useLayout();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  useEffect(() => {
    const unsubOpened = nexus.vault.onOpened((vault) => {
      openVault(vault);
    });
    const unsubClosed = nexus.vault.onClosed(() => {
      closeVault();
    });
    return () => {
      unsubOpened();
      unsubClosed();
    };
  }, [openVault, closeVault]);

  useEffect(() => {
    const unsub = nexus.theme.onChange((t) => {
      if (theme === 'system') {
        setTheme(t);
      }
    });
    return unsub;
  }, [theme, setTheme]);

  const handleOpenVault = async (path: string, type: 'copy' | 'real') => {
    await nexus.vault.open(path, type);
  };

  const handleSafeCopy = async (sourcePath: string) => {
    const result = await nexus.vault.safeCopy(sourcePath);
    await nexus.vault.open(result.destPath, 'copy');
  };

  return (
    <div className="app" style={{ '--tree-width': `${layout.treeWidth}px`, '--tool-width': `${layout.toolStripExpanded ? 72 : 44}px` }}>
      <TitleBar
        currentVault={currentVault}
        recentVaults={recentVaults}
        theme={theme}
        systemTheme={systemTheme}
        view={layout.view}
        paneOrder={layout.paneOrder}
        onOpenVault={handleOpenVault}
        onSafeCopy={handleSafeCopy}
        onCloseVault={closeVault}
        onRemoveRecent={removeRecentVault}
        onThemeChange={setTheme}
        onViewChange={(v) => setLayout({ view: v })}
        onPaneOrderChange={() => setLayout({ paneOrder: layout.paneOrder === 'board-graph' ? 'graph-board' : 'board-graph' })}
        onSafeCopyClick={handleSafeCopy}
      />
      <div className="body">
        <FolderTree
          vault={currentVault}
          onSelect={(path) => setSelectedFile(path)}
          expandPaths={layout.expandPaths || []}
          onExpandChange={(paths) => setLayout({ expandPaths: paths })}
        />
        <ToolStrip expanded={layout.toolStripExpanded} onToggle={() => setLayout({ toolStripExpanded: !layout.toolStripExpanded })} />
        <MainArea
          vault={currentVault}
          view={layout.view}
          paneOrder={layout.paneOrder}
          paneRatio={layout.paneRatio}
          onPaneRatioChange={(ratio) => setLayout({ paneRatio: ratio })}
          selectedFile={selectedFile}
          onMaximizePane={(pane) => setLayout({ maximizedPane: pane })}
          onResetDivider={() => resetDivider()}
        />
      </div>
      <StatusBar
        vault={currentVault}
        selectedFile={selectedFile}
        noteCount={currentVault ? 0 : 0}
        version="0.0.1"
      />
    </div>
  );
}

export default App;