// Floating context menu + text prompt modal (window.prompt does not exist in Electron). Grok Bot.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  sep?: boolean;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 6), y: Math.min(y, window.innerHeight - r.height - 6) });
  }, [x, y]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  return (
    <div className="ctxmenu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`mi${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            <span>{it.label}</span>
            {it.hint && <small>{it.hint}</small>}
          </button>
        ),
      )}
    </div>
  );
}

export interface PromptState {
  title: string;
  initial: string;
  okLabel?: string;
  placeholder?: string;
  selectBase?: boolean;
  resolve: (v: string | null) => void;
}

export function PromptModal({ p, onDone }: { p: PromptState; onDone: () => void }) {
  const [val, setVal] = useState(p.initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = p.selectBase ? p.initial.lastIndexOf('.') : -1;
    el.setSelectionRange(0, dot > 0 ? dot : p.initial.length);
  }, [p]);
  const finish = (v: string | null) => {
    p.resolve(v);
    onDone();
  };
  return (
    <div className="modalback" onMouseDown={(e) => e.target === e.currentTarget && finish(null)}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          finish(val.trim() ? val.trim() : null);
        }}
      >
        <div className="mt">{p.title}</div>
        <input ref={ref} value={val} placeholder={p.placeholder} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && finish(null)} spellCheck={false} />
        <div className="mb">
          <button type="button" className="b2" onClick={() => finish(null)}>
            Cancel
          </button>
          <button type="submit" className="b2 primary">
            {p.okLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}
