// F: Sources panel — the hits behind the last search, as clickable citations (path + snippet). Grok Bot.
import { useState } from 'react';
import { useApp } from '../ctx';

export interface SourceHit {
  rel: string;
  title: string;
  folder: string;
  snippet: string;
  score: number;
  semantic?: boolean;
}

export function Sources({ q, hits, onClose }: { q: string; hits: SourceHit[]; onClose: () => void }) {
  const app = useApp();
  const [active, setActive] = useState<string | null>(null);
  const copy = () => {
    const md = hits.map((h, i) => `${i + 1}. [${h.title}](${encodeURI(h.rel)})${h.snippet ? ` — ${h.snippet}` : ''}`).join('\n');
    void navigator.clipboard.writeText(`Sources for "${q}":\n${md}`).then(() => app.notify('Sources copied as Markdown'));
  };
  return (
    <div className="sources" data-testid="sources-panel" role="complementary" aria-label="Sources">
      <div className="srchead">
        <b>Sources</b>
        <span className="muted" title={q}>
          “{q}” · {hits.length}
        </span>
        <div className="r">
          <button className="linkbtn" onClick={copy} title="Copy as Markdown citations">
            Copy
          </button>
          <button className="iconbtn" title="Close sources" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
      <ol className="srclist">
        {hits.map((h) => (
          <li
            key={h.rel}
            className={active === h.rel ? 'on' : ''}
            title={h.rel}
            onClick={() => {
              setActive(h.rel);
              app.openNote(h.rel);
            }}
          >
            <div className="srct">
              {h.title} {h.semantic && <span className="badge">similar</span>}
            </div>
            <div className="srcp">{h.rel}</div>
            {h.snippet && <div className="srcs">{h.snippet}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}
