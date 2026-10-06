// Status bar (Grok Bot).
import pkg from '../../../../package.json';
import type { IndexStats, VaultInfo } from '../../../shared/types';

export function StatusBar({ selected, noteCount, vault, stats, readOnly }: { selected: string | null; noteCount: string; vault: VaultInfo | null; stats: IndexStats | null; readOnly?: boolean }) {
  return (
    <footer className="status">
      <span>
        <span className="dot" />
        Local only · No account · Offline
      </span>
      {vault &&
        (readOnly ? (
          <>
            <span className="ro" title="Nothing inside this folder is ever modified. Board layout is stored in the app's own data folder.">Read-only repo</span>
            <span className="badge" title="Board Architecture view is inferred from folders and imports — not a perfect C4 model.">Architecture (inferred)</span>
          </>
        ) : vault.isCopy ? (
          <span title="Edits go to the safe copy; every write is backed up in .nexus-backups">Editing safe copy · backups on</span>
        ) : (
          <span className="warn" title="You opened the real vault. Every write is backed up in .nexus-backups">Editing REAL vault · backups on</span>
        ))}
      {selected && <span title={selected}>{selected}</span>}
      <div className="r">
        {vault && <span>{stats && stats.version > 0 ? `${stats.notes.toLocaleString()} ${readOnly ? 'files' : 'notes'} · ${stats.links.toLocaleString()} links` : noteCount}</span>}
        <span>Nexus Vault {pkg.version}</span>
      </div>
    </footer>
  );
}
