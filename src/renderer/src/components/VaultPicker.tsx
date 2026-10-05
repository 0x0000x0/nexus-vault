// Welcome screen / vault picker shown when no vault is open (Grok Bot).
import type { RecentVaultView } from '../../../shared/types';
import { CopyIcon, FolderOpenIcon, Logo } from './icons';

interface Props {
  recent: RecentVaultView[];
  busy: string | null;
  onOpenCopy: () => void;
  onOpenReal: () => void;
  onOpenRecent: (p: string) => void;
  onRemove: (p: string) => void;
}

function when(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function VaultPicker({ recent, busy, onOpenCopy, onOpenReal, onOpenRecent, onRemove }: Props) {
  return (
    <div className="welcome">
      <div className="card">
        <div className="logo">
          <Logo size={40} />
          <h1>Nexus Vault</h1>
        </div>
        <p>Open an Obsidian-style folder of Markdown notes. Everything stays on this computer. M0 is read-only.</p>
        <button className="btn primary" onClick={onOpenCopy} disabled={!!busy}>
          <CopyIcon />
          <span>
            Open a safe copy of a vault (recommended)
            <small>Copies the folder into Documents\Nexus Vault Copies and opens the copy.</small>
          </span>
        </button>
        <button className="btn" onClick={onOpenReal} disabled={!!busy}>
          <FolderOpenIcon />
          <span>
            Open folder as vault…
            <small>Opens your real vault folder (you will be asked to confirm).</small>
          </span>
        </button>
        {busy && (
          <div className="busy">
            <div className="spin" />
            {busy}
          </div>
        )}
        {recent.length > 0 && (
          <div className="recent">
            <h4>Recent vaults</h4>
            {recent.map((r) => (
              <div key={r.path} className={`item${r.exists ? '' : ' missing'}`} onClick={() => r.exists && !busy && onOpenRecent(r.path)} title={r.path}>
                <FolderOpenIcon />
                <div className="info">
                  {r.name}
                  {r.isCopy && <span className="badge">copy</span>}
                  {!r.exists && <span className="badge warn">not found</span>}
                  <small>{r.path}</small>
                </div>
                <span className="when">{when(r.lastOpened)}</span>
                <button
                  className="linkbtn"
                  title="Remove from list (does not delete any files)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(r.path);
                  }}
                >
                  Remove from list
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
