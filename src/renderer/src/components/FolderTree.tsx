// Lazy, keyboard-navigable folder tree (Grok Bot).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DirEntry, VaultInfo } from '../../../shared/types';
import { CanvasIcon, CollapseIcon, FileIcon, FolderIcon, ImageIcon, NoteIcon, RefreshIcon } from './icons';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);
// Expanded folders per vault, kept in memory for the session.
const expandedByVault = new Map<string, Set<string>>();

interface Row {
  e: DirEntry;
  depth: number;
}

interface Props {
  vault: VaultInfo;
  width: number;
  selected: string | null;
  onSelect: (rel: string | null, entry?: DirEntry) => void;
}

export function FolderTree({ vault, width, selected, onSelect }: Props) {
  const [children, setChildren] = useState<Map<string, DirEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => expandedByVault.get(vault.path) ?? new Set());
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (rel: string) => {
      try {
        const list = await window.nexus.listDir(vault.path, rel);
        setChildren((m) => new Map(m).set(rel, list));
      } catch (err) {
        setError(String((err as Error).message ?? err));
      }
    },
    [vault.path],
  );

  const reload = useCallback(async () => {
    setError(null);
    setChildren(new Map());
    const exp = expandedByVault.get(vault.path) ?? new Set<string>();
    await load('');
    for (const rel of exp) await load(rel);
  }, [vault.path, load]);

  useEffect(() => {
    setExpanded(expandedByVault.get(vault.path) ?? new Set());
    void reload();
  }, [vault.path, reload]);

  useEffect(() => {
    expandedByVault.set(vault.path, expanded);
  }, [vault.path, expanded]);

  const toggle = (rel: string, open?: boolean) => {
    setExpanded((s) => {
      const n = new Set(s);
      const willOpen = open ?? !n.has(rel);
      if (willOpen) {
        n.add(rel);
        if (!children.has(rel)) void load(rel);
      } else n.delete(rel);
      return n;
    });
  };

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (rel: string, depth: number) => {
      for (const e of children.get(rel) ?? []) {
        out.push({ e, depth });
        if (e.kind === 'folder' && expanded.has(e.relPath)) walk(e.relPath, depth + 1);
      }
    };
    walk('', 0);
    return out;
  }, [children, expanded]);

  const onKey = (ev: React.KeyboardEvent) => {
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.e.relPath === selected);
    const cur = rows[i]?.e;
    const sel = (j: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
      onSelect(r.e.relPath, r.e);
      bodyRef.current?.querySelector(`[data-rel="${CSS.escape(r.e.relPath)}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    if (ev.key === 'ArrowDown') sel(i + 1);
    else if (ev.key === 'ArrowUp') sel(i < 0 ? 0 : i - 1);
    else if (ev.key === 'ArrowRight' && cur?.kind === 'folder') {
      if (!expanded.has(cur.relPath)) toggle(cur.relPath, true);
      else sel(i + 1);
    } else if (ev.key === 'ArrowLeft' && cur) {
      if (cur.kind === 'folder' && expanded.has(cur.relPath)) toggle(cur.relPath, false);
      else {
        const parent = cur.relPath.includes('/') ? cur.relPath.slice(0, cur.relPath.lastIndexOf('/')) : null;
        if (parent) sel(rows.findIndex((r) => r.e.relPath === parent));
      }
    } else if (ev.key === 'Enter' && cur?.kind === 'folder') toggle(cur.relPath);
    else return;
    ev.preventDefault();
  };

  return (
    <aside className="tree" style={{ width }} aria-label="Files">
      <div className="treehead">
        <span className="lbl">Files</span>
        <button className="iconbtn" title="Collapse all" onClick={() => setExpanded(new Set())}>
          <CollapseIcon />
        </button>
        <button className="iconbtn" title="Refresh" onClick={() => void reload()}>
          <RefreshIcon />
        </button>
      </div>
      <div className="treebody" tabIndex={0} ref={bodyRef} onKeyDown={onKey} role="tree">
        {error && <div className="empty">Could not read folder: {error}</div>}
        {!error && children.has('') && rows.length === 0 && <div className="empty">This vault is empty.</div>}
        {rows.map(({ e, depth }) => (
          <TreeRow
            key={e.relPath}
            e={e}
            depth={depth}
            open={expanded.has(e.relPath)}
            selected={selected === e.relPath}
            onClick={() => {
              onSelect(e.relPath, e);
              if (e.kind === 'folder') toggle(e.relPath);
            }}
          />
        ))}
      </div>
    </aside>
  );
}

function TreeRow({ e, depth, open, selected, onClick }: { e: DirEntry; depth: number; open: boolean; selected: boolean; onClick: () => void }) {
  const isMd = e.kind === 'file' && e.ext === 'md';
  const label = isMd ? e.name.slice(0, -3) : e.kind === 'file' && e.ext === 'canvas' ? e.name.slice(0, -7) : e.name;
  const icon = e.kind === 'folder' ? <FolderIcon /> : isMd ? <NoteIcon /> : e.ext === 'canvas' ? <CanvasIcon /> : IMAGE_EXT.has(e.ext) ? <ImageIcon /> : <FileIcon />;
  return (
    <div
      className={`row ${e.kind}${selected ? ' sel' : ''}`}
      data-rel={e.relPath}
      role="treeitem"
      aria-expanded={e.kind === 'folder' ? open : undefined}
      aria-selected={selected}
      style={{ paddingLeft: 4 + depth * 14 }}
      onClick={onClick}
      title={e.relPath}
    >
      <span className="chev">{e.kind === 'folder' ? (open ? '▾' : '▸') : ''}</span>
      {icon}
      <span className="nm">{label}</span>
      {e.kind === 'file' && !isMd && e.ext && <span className="ext">.{e.ext}</span>}
      {e.isFolderNote && <span className="fnote" title="Has folder note" />}
      {e.kind === 'folder' && e.childCount !== undefined && <span className="count">{e.childCount}</span>}
    </div>
  );
}
