// Vault snapshots modal. Grok Bot.
import { useCallback, useEffect, useState } from 'react';
import type { SnapshotInfo } from '../../../shared/types';

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Snapshots({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<SnapshotInfo[]>([]);
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setList(await window.nexus.snapList());
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const info = await window.nexus.snapCreate(label.trim() || undefined);
      setLabel('');
      setStatus(`Created ${info.id} (${info.fileCount} files, ${fmtSize(info.bytes)})`);
      await reload();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (id: string) => {
    if (!window.confirm('Restore this snapshot? Your current notes are saved as a snapshot first; notes created since go to .trash.')) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await window.nexus.snapRestore(id);
      setStatus(`Restored ${r.restored} file(s); moved ${r.trashed} to .trash (pre-restore: ${r.preRestoreId})`);
      await reload();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: string) => {
    if (!window.confirm(`Delete snapshot ${id}?`)) return;
    setBusy(true);
    try {
      await window.nexus.snapDelete(id);
      setStatus(`Deleted ${id}`);
      await reload();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modalback" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ width: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} role="dialog" aria-label="Snapshots">
        <div className="modalhd">
          <strong>Snapshots</strong>
          <button className="iconbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modalbd" style={{ overflow: 'auto' }}>
          <p className="muted" style={{ marginTop: 0 }}>
            A snapshot is a copy of all notes and the board, stored in the vault&apos;s hidden .nexus/snapshots folder
            (code projects: only the board layout, stored in app data).
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              className="inp"
              placeholder="Optional label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <button className="btn primary" disabled={busy} onClick={() => void create()}>
              Create snapshot
            </button>
          </div>
          {list.length === 0 && <div className="empty">No snapshots yet.</div>}
          {list.map((s) => (
            <div key={s.id} className="row" style={{ alignItems: 'center', gap: 8, padding: '8px 4px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div><strong>{new Date(s.createdAt).toLocaleString()}</strong>{s.label ? ` — ${s.label}` : ''}</div>
                <small className="muted">{s.id} · {s.fileCount} files · {fmtSize(s.bytes)}</small>
              </div>
              <button className="btn" disabled={busy} onClick={() => void restore(s.id)}>Restore…</button>
              <button className="btn" disabled={busy} onClick={() => void del(s.id)}>Delete</button>
            </div>
          ))}
          {status && <div style={{ marginTop: 10, fontSize: 12 }}>{status}</div>}
        </div>
      </div>
    </div>
  );
}
