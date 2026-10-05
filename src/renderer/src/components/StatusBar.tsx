// Status bar (Grok Bot).
export function StatusBar({ selected, noteCount, hasVault }: { selected: string | null; noteCount: string; hasVault: boolean }) {
  return (
    <footer className="status">
      <span>
        <span className="dot" />
        Local only · No account · Offline
      </span>
      <span>Read-only (M0)</span>
      {selected && <span title={selected}>{selected}</span>}
      <div className="r">
        {hasVault && <span>{noteCount}</span>}
        <span>Nexus Vault {__APP_VERSION__}</span>
      </div>
    </footer>
  );
}
