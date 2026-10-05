interface StatusBarProps {
  vault: { name: string; path: string; type: 'copy' | 'real' } | null;
  selectedFile: string | null;
  noteCount: number;
  version: string;
}

export function StatusBar({ vault, selectedFile, noteCount, version }: StatusBarProps) {
  const counting = noteCount === 0 && vault;
  return (
    <footer className="status">
      <span>
        <span className="dot" />
        Local only · No account · Offline
      </span>
      <span>Read-only (M0)</span>
      <span>AI access: Off</span>
      <div className="r">
        <span>{counting ? 'counting…' : `${noteCount} notes`}</span>
        <span>Nexus Vault {version}</span>
      </div>
    </footer>
  );
}