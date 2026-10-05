// Ctrl+K quick search across note titles and content (MiniSearch index in main) + optional local Semantic mode. Grok Bot.
import { useEffect, useRef, useState } from 'react';
import type { SearchHit } from '../../../shared/types';

type Hit = SearchHit & { semantic?: boolean };

export function QuickSearch({
  onPick,
  onClose,
  onSources,
}: {
  onPick: (rel: string) => void;
  onClose: () => void;
  onSources?: (q: string, hits: Hit[]) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [i, setI] = useState(0);
  const [semOn, setSemOn] = useState(false); // chip toggled
  const [semEnabled, setSemEnabled] = useState(false); // setting
  const [semAsk, setSemAsk] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void window.nexus.semanticStatus().then((s) => setSemEnabled(s.enabled)).catch(() => undefined);
  }, []);
  useEffect(() => {
    let live = true;
    const useSem = semOn && semEnabled;
    const t = setTimeout(() => {
      void Promise.all([window.nexus.search(q), useSem && q.trim() ? window.nexus.semanticSearch(q) : Promise.resolve([])]).then(([kw, sem]) => {
        if (!live) return;
        const seen = new Set(kw.map((h) => h.rel));
        const extra: Hit[] = sem
          .filter((h) => !seen.has(h.rel))
          .map((h) => ({ rel: h.rel, title: h.title, folder: h.rel.includes('/') ? h.rel.slice(0, h.rel.lastIndexOf('/')) : '', snippet: h.snippet, score: h.score, semantic: true }));
        setHits([...kw, ...extra]);
        setI(0);
      });
    }, useSem ? 120 : 60);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, semOn, semEnabled]);
  const toggleSem = () => {
    if (!semEnabled) {
      setSemAsk((v) => !v);
      return;
    }
    setSemOn((v) => !v);
  };
  const enableSem = async () => {
    const s = await window.nexus.setSemantic(true);
    setSemEnabled(s.enabled);
    setSemOn(true);
    setSemAsk(false);
  };
  useEffect(() => {
    listRef.current?.querySelector('.qi.on')?.scrollIntoView({ block: 'nearest' });
  }, [i]);
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const mark = (s: string) => {
    if (!words.length) return s;
    const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
    return s.split(re).map((p, k) => (k % 2 ? <mark key={k}>{p}</mark> : p));
  };
  return (
    <div className="modalback" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qs" role="dialog" aria-label="Quick search">
        <div className="qsrow">
        <input
          autoFocus
          placeholder="Search notes by title or content…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') setI(Math.min(hits.length - 1, i + 1));
            else if (e.key === 'ArrowUp') setI(Math.max(0, i - 1));
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && q.trim() && hits.length && onSources) onSources(q.trim(), hits);
            else if (e.key === 'Enter' && hits[i]) {
              if (q.trim() && onSources) onSources(q.trim(), hits);
              onPick(hits[i].rel);
            }
            else return;
            e.preventDefault();
          }}
        />
          <button
            className={`chipbtn${semOn && semEnabled ? ' on' : ''}`}
            data-testid="semantic-chip"
            title={semEnabled ? 'Semantic: also find notes with similar meaning (local only)' : 'Semantic search is off'}
            onClick={toggleSem}
          >
            Semantic
          </button>
        </div>
        {semAsk && !semEnabled && (
          <div className="qsask" data-testid="semantic-ask">
            Semantic search is off. Turn it on (local only, nothing leaves this PC).{' '}
            <button className="chipbtn on" onClick={() => void enableSem()}>
              Enable
            </button>
          </div>
        )}
        <div className="qlist" ref={listRef}>
          {hits.length === 0 && <div className="muted" style={{ padding: 12 }}>{q ? 'No matches.' : 'No notes indexed yet.'}</div>}
          {hits.map((h, k) => (
            <div key={h.rel} className={`qi${k === i ? ' on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => {
                if (q.trim() && onSources) onSources(q.trim(), hits);
                onPick(h.rel);
              }}>
              <div className="qt">
                {mark(h.title)} {h.folder && <small>{h.folder}</small>} {h.semantic && <span className="badge" title={`Similarity ${Math.round(h.score * 100)}%`}>similar</span>}
              </div>
              {h.snippet && <div className="qsn">{mark(h.snippet)}</div>}
            </div>
          ))}
        </div>
        <div className="qfoot">↑↓ to move · Enter to open · Ctrl+Enter to list as Sources · Esc to close</div>
      </div>
    </div>
  );
}
