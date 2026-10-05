export interface Settings {
  theme: 'light' | 'dark' | 'system';
  recentVaults: VaultInfo[];
  lastVaultPath?: string;
  windowBounds?: Electron.Rectangle;
  layout: LayoutSettings;
}

export interface LayoutSettings {
  treeWidth: number;
  toolStripExpanded: boolean;
  paneRatio: number;
  paneOrder: 'board-graph' | 'graph-board';
  view: 'graph' | 'split' | 'board';
}

export interface VaultInfo {
  name: string;
  path: string;
  type: 'copy' | 'real';
  lastOpened: number;
  exists: boolean;
}