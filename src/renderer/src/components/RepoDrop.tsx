// Cloudflare-style drop zone for opening a code repo folder or .zip (read-only code architecture mode). Grok Bot.
import { useState } from 'react';
import type { RecentVaultView } from '../../../shared/types';
import { CodeIcon } from './icons';

interface Props {
  recent: RecentVaultView[];
  busy: boolean;
  onOpen: (pathOrZip: string) => void;
  onOpenRecent: (p: string) => void;
  onClose: () => void;
}

export function RepoDrop({ recent, busy, onOpen, onOpenRecent, onClose }: Props) {
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const repos = recent.filter((r) => r.mode === 'code');
  const pick = async (kind: 'folder' | 'zip') => {
    const p = await window.nexus.pickRepo(kind);
    if (p) onOpen(p);
  };
  return (
    <div className="modalback" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="repodrop" data-testid="repo-drop">
        <div className="rdhead">
          <CodeIcon /> <b>Open GitHub repo / code project</b>
          <button className="iconbtn" onClick={onClose} disabled={busy} title="Close">
            ✕
          </button>
        </div>
        <div
          className={`dropzone${over ? ' over' : ''}`}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setOver(true);
            }
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (!f) return;
            const p = window.nexus.pathForFile(f);
            if (!p) return setErr('Could not read the dropped item. Try the Browse buttons.');
            setErr(null);
            onOpen(p);
          }}
        >
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4M7 9l5-5 5 5" />
            <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
          </svg>
          <div className="dzt">Drop a repo folder or .zip here</div>
          <div className="muted">e.g. a cloned project, or GitHub’s “Code → Download ZIP”. No login, no network.</div>
          <div className="dzb">
            <button className="b2 primary" disabled={busy} onClick={() => void pick('folder')}>
              Browse folder…
            </button>
            <button className="b2" disabled={busy} onClick={() => void pick('zip')}>
              Browse .zip…
            </button>
          </div>
        </div>
        {err && <div className="npwarn">{err}</div>}
        <div className="muted small">
          Strictly read-only: Nexus Vault never changes files in the repo. Zips are extracted into the app’s own data folder; board layouts are stored there too. After open, the Board shows a nested <b>Architecture</b> view (toggle Folders anytime).
        </div>
        {repos.length > 0 && (
          <div className="recent">
            <h4>Recent repos</h4>
            {repos.map((r) => (
              <div key={r.path} className={`item${r.exists ? '' : ' missing'}`} onClick={() => r.exists && !busy && onOpenRecent(r.path)} title={r.source ?? r.path}>
                <CodeIcon />
                <div className="info">
                  {r.name}
                  {r.source && <span className="badge">zip</span>}
                  {!r.exists && <span className="badge warn">not found</span>}
                  <small>{r.source ?? r.path}</small>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
