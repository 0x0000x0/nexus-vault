// Ctrl+K quick search across note titles and content (MiniSearch index in main). Grok Bot.
import { useEffect, useRef, useState } from 'react';
import type { SearchHit } from '../../../shared/types';

export function QuickSearch({ onPick, onClose }: { onPick: (rel: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [i, setI] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void window.nexus.search(q).then((h) => {
        if (!live) return;
        setHits(h);
        setI(0);
      });
    }, 60);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
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
        <input
          autoFocus
          placeholder="Search notes by title or content…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') setI(Math.min(hits.length - 1, i + 1));
            else if (e.key === 'ArrowUp') setI(Math.max(0, i - 1));
            else if (e.key === 'Enter' && hits[i]) onPick(hits[i].rel);
            else return;
            e.preventDefault();
          }}
        />
        <div className="qlist" ref={listRef}>
          {hits.length === 0 && <div className="muted" style={{ padding: 12 }}>{q ? 'No matches.' : 'No notes indexed yet.'}</div>}
          {hits.map((h, k) => (
            <div key={h.rel} className={`qi${k === i ? ' on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => onPick(h.rel)}>
              <div className="qt">
                {mark(h.title)} {h.folder && <small>{h.folder}</small>}
              </div>
              {h.snippet && <div className="qsn">{mark(h.snippet)}</div>}
            </div>
          ))}
        </div>
        <div className="qfoot">↑↓ to move · Enter to open · Esc to close</div>
      </div>
    </div>
  );
}
