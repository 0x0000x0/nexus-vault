// Lazy, keyboard-navigable folder tree with Obsidian-style context menu and drag-to-board (Grok Bot).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DirEntry, FsChange, VaultInfo } from '../../../shared/types';
import { dirOf, errMsg, useApp } from '../ctx';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { CanvasIcon, CollapseIcon, FileIcon, FolderIcon, ImageIcon, NoteIcon, RefreshIcon } from './icons';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);
export const DRAG_MIME = 'application/x-nexus-path';
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
  openRel: string | null;
  onSelect: (rel: string | null, entry?: DirEntry) => void;
  reveal: { rel: string; n: number } | null;
}

export function FolderTree({ vault, width, selected, openRel, onSelect, reveal }: Props) {
  const app = useApp();
  const [children, setChildren] = useState<Map<string, DirEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => expandedByVault.get(vault.path) ?? new Set());
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const childrenRef = useRef(children);
  childrenRef.current = children;

  const load = useCallback(
    async (rel: string) => {
      try {
        const list = await window.nexus.listDir(vault.path, rel);
        setChildren((m) => new Map(m).set(rel, list));
      } catch (err) {
        if (rel === '') setError(errMsg(err));
        else
          setChildren((m) => {
            const n = new Map(m);
            n.delete(rel);
            return n;
          });
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

  // Live updates from the file watcher: re-list only folders we already loaded.
  useEffect(
    () =>
      window.nexus.onFsChanged((c: FsChange) => {
        const loaded = childrenRef.current;
        const dirs = new Set(c.dirs.filter((d) => loaded.has(d)));
        for (const d of dirs) void load(d);
      }),
    [load],
  );

  // Reveal a path: expand all parents, select and scroll.
  useEffect(() => {
    if (!reveal) return;
    const parts = reveal.rel.split('/');
    const parents: string[] = [];
    for (let i = 1; i < parts.length; i++) parents.push(parts.slice(0, i).join('/'));
    void (async () => {
      for (const p of parents) if (!childrenRef.current.has(p)) await load(p);
      setExpanded((s) => new Set([...s, ...parents]));
      setTimeout(() => bodyRef.current?.querySelector(`[data-rel="${CSS.escape(reveal.rel)}"]`)?.scrollIntoView({ block: 'nearest' }), 50);
    })();
  }, [reveal, load]);

  const toggle = (rel: string, open?: boolean) => {
    setExpanded((s) => {
      const n = new Set(s);
      const willOpen = open ?? !n.has(rel);
      if (willOpen) {
        n.add(rel);
        if (!childrenRef.current.has(rel)) void load(rel);
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

  const activate = (e: DirEntry) => {
    onSelect(e.relPath, e);
    if (e.kind === 'folder') toggle(e.relPath);
    else if (e.ext === 'md') app.openNote(e.relPath);
  };

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
    } else if (ev.key === 'Enter' && cur) activate(cur);
    else if (ev.key === 'F2' && cur) void rename(cur);
    else if (ev.key === 'Delete' && cur) void del(cur);
    else return;
    ev.preventDefault();
  };

  // ---------- actions ----------
  const guard = async (f: () => Promise<void>) => {
    try {
      await f();
    } catch (e) {
      app.notify(errMsg(e), true);
    }
  };
  const newNoteIn = (dir: string) =>
    guard(async () => {
      if (dir) toggle(dir, true);
      const rel = await app.newNote(dir);
      if (rel) {
        await load(dir);
        onSelect(rel);
      }
    });
  const newFolderIn = (dir: string) =>
    guard(async () => {
      if (dir) toggle(dir, true);
      const rel = await app.newFolder(dir);
      if (rel) {
        await load(dir);
        onSelect(rel);
      }
    });
  const rename = (e: DirEntry) =>
    guard(async () => {
      const name = await app.ask(`Rename ${e.kind}`, e.name, { okLabel: 'Rename', selectBase: e.kind === 'file' });
      if (!name || name === e.name) return;
      const nrel = await window.nexus.renamePath(e.relPath, name);
      await load(dirOf(e.relPath));
      if (e.kind === 'folder' && expanded.has(e.relPath)) {
        setExpanded((s) => {
          const n = new Set([...s].map((x) => (x === e.relPath || x.startsWith(e.relPath + '/') ? nrel + x.slice(e.relPath.length) : x)));
          return n;
        });
        await load(nrel);
      }
      onSelect(nrel);
      app.renamed(e.relPath, nrel);
    });
  const del = (e: DirEntry) =>
    guard(async () => {
      const to = await window.nexus.deletePath(e.relPath);
      if (!to) return;
      await load(dirOf(e.relPath));
      app.deleted(e.relPath);
      app.notify(`Moved "${e.name}" to ${to.split('/')[0]} (recoverable)`);
    });
  const duplicate = (e: DirEntry) =>
    guard(async () => {
      const nrel = await window.nexus.duplicatePath(e.relPath);
      await load(dirOf(e.relPath));
      onSelect(nrel);
    });
  const reveal_ = (rel: string) => guard(() => window.nexus.revealPath(rel));
  const copyPath = (rel: string) =>
    guard(async () => {
      const abs = await window.nexus.copyPath(rel);
      app.notify(`Copied: ${abs}`);
    });

  const revealLabel = window.nexus.platform === 'win32' ? 'Reveal in File Explorer' : window.nexus.platform === 'darwin' ? 'Reveal in Finder' : 'Show in system file manager';

  const openMenu = (ev: React.MouseEvent, e: DirEntry | null) => {
    ev.preventDefault();
    ev.stopPropagation();
    let items: MenuItem[];
    if (!e) {
      items = [
        { label: 'New note', onClick: () => void newNoteIn('') },
        { label: 'New folder', onClick: () => void newFolderIn('') },
        { sep: true, label: '' },
        { label: 'Open vault root on board', onClick: () => app.openOnBoard('', 'folder') },
        { label: revealLabel, onClick: () => void reveal_('') },
      ];
    } else {
      onSelect(e.relPath, e);
      const isMd = e.kind === 'file' && e.ext === 'md';
      const dir = e.kind === 'folder' ? e.relPath : dirOf(e.relPath);
      items = [
        ...(isMd ? [{ label: 'Open', onClick: () => app.openNote(e.relPath) }] : []),
        { label: e.kind === 'folder' ? 'New note in folder' : 'New note', onClick: () => void newNoteIn(dir) },
        { label: e.kind === 'folder' ? 'New subfolder' : 'New folder', onClick: () => void newFolderIn(dir) },
        { sep: true, label: '' },
        { label: 'Open on board', onClick: () => app.openOnBoard(e.relPath, e.kind), disabled: e.kind === 'file' && !isMd && !IMAGE_EXT.has(e.ext) },
        { label: 'Show in graph', onClick: () => app.showInGraph(e.relPath), disabled: !isMd },
        { sep: true, label: '' },
        { label: 'Rename…', hint: 'F2', onClick: () => void rename(e) },
        { label: 'Duplicate', onClick: () => void duplicate(e) },
        { sep: true, label: '' },
        { label: revealLabel, onClick: () => void reveal_(e.relPath) },
        { label: 'Copy path', onClick: () => void copyPath(e.relPath) },
        { sep: true, label: '' },
        { label: 'Delete…', hint: 'Del', danger: true, onClick: () => void del(e) },
      ];
    }
    setMenu({ x: ev.clientX, y: ev.clientY, items });
  };

  return (
    <aside className="tree" style={{ width }} aria-label="Files">
      <div className="treehead">
        <span className="lbl">Files</span>
        <button className="iconbtn" title="New note" onClick={() => void newNoteIn('')}>
          <NoteIcon />
        </button>
        <button className="iconbtn" title="New folder" onClick={() => void newFolderIn('')}>
          <FolderIcon />
        </button>
        <button className="iconbtn" title="Collapse all" onClick={() => setExpanded(new Set())}>
          <CollapseIcon />
        </button>
        <button className="iconbtn" title="Refresh" onClick={() => void reload()}>
          <RefreshIcon />
        </button>
      </div>
      <div className="treebody" tabIndex={0} ref={bodyRef} onKeyDown={onKey} role="tree" onContextMenu={(ev) => openMenu(ev, null)}>
        {error && <div className="empty">Could not read folder: {error}</div>}
        {!error && children.has('') && rows.length === 0 && <div className="empty">This vault is empty. Right-click to add a note.</div>}
        {rows.map(({ e, depth }) => (
          <TreeRow
            key={e.relPath}
            e={e}
            depth={depth}
            open={expanded.has(e.relPath)}
            selected={selected === e.relPath}
            active={openRel === e.relPath}
            onClick={() => activate(e)}
            onContextMenu={(ev) => openMenu(ev, e)}
          />
        ))}
        <div className="treepad" />
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </aside>
  );
}

function TreeRow({ e, depth, open, selected, active, onClick, onContextMenu }: { e: DirEntry; depth: number; open: boolean; selected: boolean; active: boolean; onClick: () => void; onContextMenu: (ev: React.MouseEvent) => void }) {
  const isMd = e.kind === 'file' && e.ext === 'md';
  const label = isMd ? e.name.slice(0, -3) : e.kind === 'file' && e.ext === 'canvas' ? e.name.slice(0, -7) : e.name;
  const icon = e.kind === 'folder' ? <FolderIcon /> : isMd ? <NoteIcon /> : e.ext === 'canvas' ? <CanvasIcon /> : IMAGE_EXT.has(e.ext) ? <ImageIcon /> : <FileIcon />;
  return (
    <div
      className={`row ${e.kind}${selected ? ' sel' : ''}${active ? ' active' : ''}`}
      data-rel={e.relPath}
      role="treeitem"
      aria-expanded={e.kind === 'folder' ? open : undefined}
      aria-selected={selected}
      style={{ paddingLeft: 4 + depth * 14 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={(ev) => {
        ev.dataTransfer.setData(DRAG_MIME, JSON.stringify({ rel: e.relPath, kind: e.kind, ext: e.ext }));
        ev.dataTransfer.setData('text/plain', e.relPath);
        ev.dataTransfer.effectAllowed = 'copy';
      }}
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
