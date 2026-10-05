// AI access (MCP) modal — localhost only, token auth, OFF by default. Grok Bot.
import { useCallback, useEffect, useState } from 'react';

type Status = {
  enabled: boolean;
  running: boolean;
  port: number;
  readOnly: boolean;
  token: string;
  url: string;
  error?: string;
};

export function AiAccess({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<Status | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSt(await window.nexus.mcpStatus());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const patch = async (p: { enabled?: boolean; readOnly?: boolean; port?: number }) => {
    setBusy(true);
    setErr(null);
    try {
      setSt(await window.nexus.mcpSet(p));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const regen = async () => {
    setBusy(true);
    setErr(null);
    try {
      setSt(await window.nexus.mcpRegenToken());
      setShowToken(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const token = st?.token || '';
  const masked = token ? `${token.slice(0, 4)}…${token.slice(-4)}` : '';
  const cfg =
    st && token
      ? JSON.stringify(
          {
            mcpServers: {
              'nexus-vault': {
                type: 'http',
                url: st.url,
                headers: { Authorization: `Bearer ${token}` },
              },
            },
          },
          null,
          2,
        )
      : '';

  return (
    <div className="modalback" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ width: 480 }} role="dialog" aria-label="AI access">
        <div className="modalhd">
          <strong>AI access (MCP)</strong>
          <button className="iconbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modalbd">
          <p className="muted" style={{ marginTop: 0 }}>
            Off by default. Local only (127.0.0.1). Clients need the token.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={!!st?.enabled}
              disabled={busy || !st}
              onChange={(e) => void patch({ enabled: e.target.checked })}
            />
            Enabled
            {st?.running && <span className="badge">running</span>}
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={st ? st.readOnly : true}
              disabled={busy || !st}
              onChange={(e) => void patch({ readOnly: e.target.checked })}
            />
            Read-only (AI can search and read, not edit)
          </label>
          {st?.enabled && (
            <>
              <div style={{ marginBottom: 8 }}>
                <div className="lbl">URL</div>
                <code style={{ fontSize: 12 }}>{st.url}</code>{' '}
                <button className="btn" disabled={busy} onClick={() => void navigator.clipboard.writeText(st.url)}>
                  Copy
                </button>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div className="lbl">Token</div>
                <code style={{ fontSize: 12 }}>{showToken ? token : masked}</code>{' '}
                <button className="btn" disabled={busy || !token} onClick={() => setShowToken((v) => !v)}>
                  {showToken ? 'Hide' : 'Show'}
                </button>{' '}
                <button className="btn" disabled={busy || !token} onClick={() => void navigator.clipboard.writeText(token)}>
                  Copy
                </button>{' '}
                <button className="btn" disabled={busy} onClick={() => void regen()}>
                  New token
                </button>
              </div>
              {cfg && (
                <div style={{ marginBottom: 8 }}>
                  <div className="lbl">Client config</div>
                  <pre style={{ fontSize: 11, overflow: 'auto', maxHeight: 160, background: 'var(--panel)', padding: 8 }}>{cfg}</pre>
                </div>
              )}
            </>
          )}
          {(err || st?.error) && <div className="banner err">{err || st?.error}</div>}
        </div>
      </div>
    </div>
  );
}
