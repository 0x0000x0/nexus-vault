// Milanote + IcePanel style board: note/folder/text/group/image/link cards, lines, drill-down (Grok Bot).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardData, BoardEdge, BoardFile, BoardNode, BoardNodeType, DirEntry, FsChange, ViewMode } from '../../../shared/types';
import { baseName, dirOf, errMsg, folderColor, noteTitle, useApp } from '../ctx';
import { bbox, CARD, clipToRect, freeSlot, inside, normalizeBoard, normalizeUrl, uid } from './board-utils';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { DRAG_MIME } from './FolderTree';
import { BoardIcon, FolderIcon, ImageIcon } from './icons';
import { MaxBtn } from './Panes';

export type ToolId = 'note' | 'text' | 'group' | 'image' | 'link' | 'line';
export const TOOL_MIME = 'application/x-nexus-tool';
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

interface Props {
  view: ViewMode;
  onMax: () => void;
  folder: string;
  setFolder: (f: string) => void;
  toolReq: { tool: ToolId; n: number } | null;
  lineMode: boolean;
  setLineMode: (on: boolean) => void;
  focus: { rel: string; n: number } | null;
  selectedRel: string | null;
  readOnly?: boolean; // code mode: never write into the folder (board layout still saved elsewhere by main)
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: 'move'; sx: number; sy: number; orig: Map<string, { x: number; y: number }>; moved: boolean }
  | { kind: 'resize'; id: string; sx: number; sy: number; w: number; h: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; add: Set<string> }
  | { kind: 'line'; from: string; x: number; y: number };

interface RenderEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  link: boolean; // mirrors a [[link]] in the source note
  pending?: boolean;
}

export function BoardPane(p: Props) {
  const app = useApp();
  const { folder } = p;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<BoardFile | null>(null);
  const fileRef = useRef<BoardFile | null>(null);
  fileRef.current = file;
  const [entries, setEntries] = useState<{ folder: string; list: DirEntry[] } | null>(null);
  const [previews, setPreviews] = useState<Record<string, { preview: string; tags: string[] }>>({});
  const [kids, setKids] = useState<Record<string, DirEntry[]>>({});
  const [images, setImages] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editingEdge, setEditingEdge] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [pending, setPending] = useState<RenderEdge[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dropHint, setDropHint] = useState(false);
  const saveTimer = useRef<number | null>(null);

  const board: BoardData = useMemo(() => normalizeBoard(file?.boards[folder]), [file, folder]);
  const view = board.view ?? { x: 0, y: 0, k: 1 };
  const boardRef = useRef(board);
  boardRef.current = board;
  const viewRef = useRef(view);
  viewRef.current = view;

  // ---------- persistence ----------
  useEffect(() => {
    let live = true;
    setFile(null);
    void window.nexus.readBoard().then((f) => live && setFile(f));
    return () => {
      live = false;
    };
  }, [app.vault.path]);

  const flush = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const f = fileRef.current;
    if (f) window.nexus.writeBoard(f).catch((e) => app.notify('Could not save board: ' + errMsg(e), true));
  }, [app]);
  useEffect(() => () => flush(), [flush]);

  const update = useCallback(
    (fn: (b: BoardData) => BoardData, f = folder) => {
      setFile((cur) => {
        if (!cur) return cur;
        const next: BoardFile = { version: 1, boards: { ...cur.boards, [f]: fn(normalizeBoard(cur.boards[f])) } };
        fileRef.current = next;
        return next;
      });
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flush, 400);
    },
    [folder, flush],
  );
  const setView = (v: { x: number; y: number; k: number }) => update((b) => ({ ...b, view: v }));

  // ---------- folder contents ----------
  const loadEntries = useCallback(async () => {
    try {
      const list = await window.nexus.listDir(app.vault.path, folder);
      setEntries({ folder, list });
    } catch {
      setEntries({ folder, list: [] });
      if (folder) p.setFolder(dirOf(folder));
    }
  }, [app.vault.path, folder, p]);
  useEffect(() => {
    setEntries(null);
    setSel(new Set());
    setSelEdge(null);
    void loadEntries();
  }, [loadEntries]);
  useEffect(
    () =>
      window.nexus.onFsChanged((c: FsChange) => {
        if (c.dirs.includes(folder)) void loadEntries();
        setKids((k) => {
          const n = { ...k };
          for (const d of c.dirs) delete n[d];
          return n;
        });
      }),
    [folder, loadEntries],
  );

  const noteSet = app.files;
  // Only prune/populate once the file list for this index is in (avoids wiping cards during a refresh race).
  const graphReady = app.graph.version >= 0 && (app.files.size > 0 || app.graph.nodes.length === 0);

  // ---------- auto-populate: notes + subfolders of the current folder ----------
  useEffect(() => {
    if (!file || !entries || entries.folder !== folder || !graphReady) return;
    const b = board;
    const listed = new Set(entries.list.map((e) => e.relPath));
    const have = new Set(b.nodes.map((n) => n.file).filter(Boolean) as string[]);
    const hidden = new Set(b.hidden);
    const nodes = b.nodes.filter((n) => {
      if (n.type === 'note') return !n.file || noteSet.has(n.file);
      if (n.type === 'folder' && n.file !== undefined && dirOf(n.file) === folder) return listed.has(n.file);
      return true;
    });
    let changed = nodes.length !== b.nodes.length;
    const cols = gridCols();
    const add = (e: DirEntry, type: BoardNodeType) => {
      const sz = CARD[type as 'note' | 'folder'];
      const pos = freeSlot(nodes, sz.w, sz.h, cols);
      nodes.push({ id: uid(), type, x: pos.x, y: pos.y, w: sz.w, h: sz.h, file: e.relPath });
      changed = true;
    };
    for (const e of entries.list) if (e.kind === 'folder' && !have.has(e.relPath) && !hidden.has(e.relPath)) add(e, 'folder');
    for (const e of entries.list) if (e.kind === 'file' && (e.ext === 'md' || p.readOnly) && !have.has(e.relPath) && !hidden.has(e.relPath) && noteSet.has(e.relPath)) add(e, 'note');
    if (changed) {
      const ids = new Set(nodes.map((n) => n.id));
      update((bb) => ({ ...bb, nodes, edges: bb.edges.filter((ed) => ids.has(ed.from) && ids.has(ed.to)), view: bb.view ?? undefined }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file === null, entries, folder, noteSet, graphReady]);

  // ---------- data for cards ----------
  const noteRels = useMemo(() => board.nodes.filter((n) => n.type === 'note' && n.file).map((n) => n.file!), [board.nodes]);
  const noteKey = noteRels.join('\n');
  useEffect(() => {
    if (!noteRels.length) return;
    let live = true;
    void window.nexus.previews(noteRels).then((r) => live && setPreviews((cur) => ({ ...cur, ...r })));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKey, app.indexVersion]);
  useEffect(() => {
    for (const n of board.nodes) {
      if (n.type === 'folder' && n.file !== undefined && !kids[n.file]) {
        const f = n.file;
        setKids((k) => ({ ...k, [f]: [] }));
        void window.nexus.listDir(app.vault.path, f).then((l) => setKids((k) => ({ ...k, [f]: l }))).catch(() => undefined);
      }
      if (n.type === 'image' && n.file && !images[n.file]) {
        const f = n.file;
        setImages((m) => ({ ...m, [f]: 'loading' }));
        void window.nexus.readImage(f).then((d) => setImages((m) => ({ ...m, [f]: d }))).catch(() => setImages((m) => ({ ...m, [f]: 'error' })));
      }
    }
  }, [board.nodes, kids, images, app.vault.path]);

  const folders = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of app.graph.nodes) if (!n.ghost && n.folder) c.set(n.folder, (c.get(n.folder) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  }, [app.graph]);

  // ---------- edges ----------
  const byId = useMemo(() => new Map(board.nodes.map((n) => [n.id, n])), [board.nodes]);
  const noteNode = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of board.nodes) if (n.type === 'note' && n.file && !m.has(n.file)) m.set(n.file, n.id);
    return m;
  }, [board.nodes]);
  const edges: RenderEdge[] = useMemo(() => {
    const out: RenderEdge[] = [];
    const seen = new Set<string>();
    const labelOf = new Map(board.edges.filter((e) => e.link).map((e) => [`${e.from}>${e.to}`, e.label]));
    // Code mode (IcePanel style): a file inside a folder box is represented by that box.
    const folderCards = p.readOnly ? board.nodes.filter((n) => n.type === 'folder' && n.file !== undefined).sort((x, y) => y.file!.length - x.file!.length) : [];
    const cardOf = (f: string) => noteNode.get(f) ?? folderCards.find((n) => n.file === '' || f.startsWith(n.file + '/'))?.id;
    for (const [src, tgt] of app.fileLinks) {
      const a = cardOf(src);
      const b = cardOf(tgt);
      if (!a || !b || a === b) continue;
      const key = `${a}>${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: 'L:' + key, from: a, to: b, link: true, label: labelOf.get(key) });
    }
    for (const pe of pending) if (!seen.has(`${pe.from}>${pe.to}`) && byId.has(pe.from) && byId.has(pe.to)) out.push(pe);
    for (const e of board.edges) if (!e.link && byId.has(e.from) && byId.has(e.to)) out.push({ id: e.id, from: e.from, to: e.to, label: e.label, link: false });
    return out;
  }, [app.fileLinks, noteNode, board.edges, pending, byId, p.readOnly, board.nodes]);
  useEffect(() => setPending([]), [app.graph.version]);

  /** Grid columns that fit the visible pane at ~80% zoom (2..6). */
  const gridCols = () => Math.max(2, Math.min(6, Math.floor(((wrapRef.current?.clientWidth ?? 800) / 0.8 - 40) / 250)));

  // ---------- coordinates ----------
  const toWorld = (cx: number, cy: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  };
  const centerWorld = () => {
    const r = wrapRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    const j = () => (Math.random() - 0.5) * 60;
    return { x: (r.width / 2 - v.x) / v.k + j(), y: (r.height / 2 - v.y) / v.k + j() };
  };
  const fit = useCallback(() => {
    const el = wrapRef.current;
    const bb = bbox(boardRef.current.nodes);
    if (!el || !bb) return setView({ x: 0, y: 0, k: 1 });
    const k = Math.max(0.55, Math.min(1.1, Math.min((el.clientWidth - 60) / bb.w, (el.clientHeight - 60) / bb.h)));
    // Center if it fits; otherwise start at the top-left of the content (readable zoom beats seeing everything).
    const x = bb.w * k <= el.clientWidth - 40 ? (el.clientWidth - bb.w * k) / 2 - bb.x * k : 20 - bb.x * k;
    const y = bb.h * k <= el.clientHeight - 40 ? (el.clientHeight - bb.h * k) / 2 - bb.y * k : 20 - bb.y * k;
    setView({ k, x, y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);
  const centerOn = (n: BoardNode) => {
    const el = wrapRef.current;
    if (!el) return;
    const k = Math.max(viewRef.current.k, 0.8);
    setView({ k, x: el.clientWidth / 2 - (n.x + n.w / 2) * k, y: el.clientHeight / 2 - (n.y + n.h / 2) * k });
  };

  // ---------- adding things ----------
  const addNode = (n: Omit<BoardNode, 'id'>, selectIt = true): string => {
    const id = uid();
    update((b) => ({ ...b, nodes: [...b.nodes, { ...n, id }], hidden: n.file ? b.hidden.filter((h) => h !== n.file) : b.hidden }));
    if (selectIt) {
      setSel(new Set([id]));
      setSelEdge(null);
    }
    return id;
  };
  const placeFile = (rel: string, kind: 'file' | 'folder', at: { x: number; y: number }) => {
    const existing = boardRef.current.nodes.find((n) => n.file === rel && n.type !== 'image');
    if (existing) {
      update((b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === existing.id ? { ...n, x: at.x - n.w / 2, y: at.y - 20 } : n)) }));
      setSel(new Set([existing.id]));
      return;
    }
    const type: BoardNodeType = kind === 'folder' ? 'folder' : IMAGE_EXT.test(rel) ? 'image' : 'note';
    if (type === 'note' && !/\.md$/i.test(rel)) return app.notify('Only notes, folders and images can be placed on the board.', true);
    const sz = CARD[type];
    addNode({ type, file: rel, x: at.x - sz.w / 2, y: at.y - 20, w: sz.w, h: sz.h });
  };

  const runTool = async (tool: ToolId, at?: { x: number; y: number }) => {
    if (tool === 'line') return p.setLineMode(!p.lineMode);
    const pt = at ?? centerWorld();
    try {
      if (tool === 'note') {
        if (p.readOnly) return app.notify('This folder is read-only.', true);
        const name = await app.ask('New note on this board', 'Untitled', { okLabel: 'Create note' });
        if (!name) return;
        const rel = await window.nexus.createNote(folder, name, `# ${name.replace(/\.md$/i, '')}\n\n`);
        addNode({ type: 'note', file: rel, x: pt.x - CARD.note.w / 2, y: pt.y - 30, w: CARD.note.w, h: CARD.note.h });
        app.openNote(rel, { edit: true });
      } else if (tool === 'text') {
        const id = addNode({ type: 'text', text: '', x: pt.x - CARD.text.w / 2, y: pt.y - 30, w: CARD.text.w, h: CARD.text.h, color: 'yellow' });
        setEditing(id);
      } else if (tool === 'group') {
        addNode({ type: 'group', text: 'Group', x: pt.x - CARD.group.w / 2, y: pt.y - 40, w: CARD.group.w, h: CARD.group.h });
      } else if (tool === 'image') {
        if (p.readOnly) return app.notify('This folder is read-only.', true);
        const rel = await window.nexus.pickImage();
        if (rel) addNode({ type: 'image', file: rel, x: pt.x - CARD.image.w / 2, y: pt.y - 40, w: CARD.image.w, h: CARD.image.h });
      } else if (tool === 'link') {
        const raw = await app.ask('Add a link card', 'https://', { okLabel: 'Add link', placeholder: 'https://example.com' });
        if (!raw) return;
        const url = normalizeUrl(raw);
        if (!url) return app.notify('That is not a valid http(s) link.', true);
        addNode({ type: 'link', url, text: '', x: pt.x - CARD.link.w / 2, y: pt.y - 30, w: CARD.link.w, h: CARD.link.h });
      }
    } catch (e) {
      app.notify(errMsg(e), true);
    }
  };
  const lastTool = useRef(0);
  useEffect(() => {
    if (!p.toolReq || p.toolReq.n === lastTool.current || !file) return;
    lastTool.current = p.toolReq.n;
    void runTool(p.toolReq.tool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.toolReq, file]);

  // "Open on board": select + center the card (adding it if missing).
  const lastFocus = useRef(0);
  useEffect(() => {
    const f = p.focus;
    if (!f || f.n === lastFocus.current || !file || !entries || entries.folder !== folder) return;
    if (f.rel === folder) {
      lastFocus.current = f.n;
      setTimeout(fit, 50);
      return;
    }
    const n = board.nodes.find((x) => x.file === f.rel);
    lastFocus.current = f.n;
    if (n) {
      setSel(new Set([n.id]));
      centerOn(n);
    } else {
      const isDir = entries.list.some((e) => e.relPath === f.rel && e.kind === 'folder');
      const type: BoardNodeType = isDir ? 'folder' : IMAGE_EXT.test(f.rel) ? 'image' : 'note';
      const sz = CARD[type];
      const pos = freeSlot(board.nodes, sz.w, sz.h, gridCols());
      const node = { type, file: f.rel, x: pos.x, y: pos.y, w: sz.w, h: sz.h };
      addNode(node);
      centerOn({ ...node, id: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focus, file, entries, folder]);

  // First visit of a board: fit to content.
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!file || fittedFor.current === folder || !entries || entries.folder !== folder) return;
    if (board.view) {
      fittedFor.current = folder;
      return;
    }
    if (board.nodes.length) {
      fittedFor.current = folder;
      setTimeout(fit, 30);
    }
  }, [file, folder, entries, board.nodes.length, board.view, fit]);

  // ---------- deleting ----------
  const deleteSelection = async () => {
    if (selEdge) {
      const e = edges.find((x) => x.id === selEdge);
      setSelEdge(null);
      if (!e) return;
      if (e.link) {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (a?.file && b?.file) {
          if (p.readOnly) return app.notify('Read-only: links cannot be removed here.', true);
          try {
            const changed = await window.nexus.removeConnection(a.file, b.file);
            app.notify(changed ? `Removed link to "${noteTitle(b.file)}" from "${noteTitle(a.file)}" (text kept, backup saved).` : 'Link was already gone.');
          } catch (err) {
            app.notify(errMsg(err), true);
          }
        }
        update((bd) => ({ ...bd, edges: bd.edges.filter((x) => !(x.link && x.from === e.from && x.to === e.to)) }));
        setPending((pp) => pp.filter((x) => x.id !== e.id));
      } else update((bd) => ({ ...bd, edges: bd.edges.filter((x) => x.id !== e.id) }));
      return;
    }
    if (!sel.size) return;
    const ids = new Set(sel);
    update((b) => {
      const gone = b.nodes.filter((n) => ids.has(n.id));
      const hide = gone.filter((n) => (n.type === 'note' || n.type === 'folder') && n.file !== undefined && dirOf(n.file) === folder).map((n) => n.file!);
      return { ...b, nodes: b.nodes.filter((n) => !ids.has(n.id)), edges: b.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to)), hidden: [...new Set([...b.hidden, ...hide])] };
    });
    setSel(new Set());
    const notes = [...ids].map((i) => byId.get(i)).filter((n) => n?.type === 'note').length;
    if (notes) app.notify(`Removed ${notes} card${notes > 1 ? 's' : ''} from the board (the notes themselves are untouched).`);
  };

  // ---------- connecting ----------
  const connect = async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const a = byId.get(fromId);
    const b = byId.get(toId);
    if (!a || !b) return;
    if (a.type === 'note' && b.type === 'note' && a.file && b.file && !p.readOnly) {
      const key = `${a.id}>${b.id}`;
      if (edges.some((e) => e.link && `${e.from}>${e.to}` === key)) return app.notify('These notes are already linked.');
      setPending((pp) => [...pp, { id: 'L:' + key, from: a.id, to: b.id, link: true, pending: true }]);
      try {
        const added = await window.nexus.addConnection(a.file, b.file);
        app.notify(added ? `Added [[${noteTitle(b.file)}]] to "${noteTitle(a.file)}" under ## Connections (backup saved).` : `"${noteTitle(a.file)}" already links to "${noteTitle(b.file)}".`);
      } catch (err) {
        setPending((pp) => pp.filter((x) => x.id !== 'L:' + key));
        app.notify(errMsg(err), true);
      }
      return;
    }
    if (boardRef.current.edges.some((e) => !e.link && e.from === fromId && e.to === toId)) return;
    const edge: BoardEdge = { id: uid(), from: fromId, to: toId };
    update((bd) => ({ ...bd, edges: [...bd.edges, edge] }));
    setSelEdge(edge.id);
  };

  const setEdgeLabel = (e: RenderEdge, label: string) => {
    const lbl = label.trim() || undefined;
    if (e.link) {
      update((bd) => {
        const rest = bd.edges.filter((x) => !(x.link && x.from === e.from && x.to === e.to));
        return { ...bd, edges: lbl ? [...rest, { id: uid(), from: e.from, to: e.to, link: true, label: lbl }] : rest };
      });
    } else update((bd) => ({ ...bd, edges: bd.edges.map((x) => (x.id === e.id ? { ...x, label: lbl } : x)) }));
  };

  // ---------- pointer handling ----------
  const startDrag = (d: Drag) => {
    dragRef.current = d;
    setDrag(d);
  };
  useEffect(() => {
    if (!drag) return;
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      let nd: Drag = d;
      if (d.kind === 'pan') {
        const moved = d.moved || Math.abs(ev.clientX - d.sx) + Math.abs(ev.clientY - d.sy) > 3;
        nd = { ...d, moved };
        update((b) => ({ ...b, view: { k: viewRef.current.k, x: d.vx + ev.clientX - d.sx, y: d.vy + ev.clientY - d.sy } }));
      } else if (d.kind === 'move') {
        const k = viewRef.current.k;
        const dx = (ev.clientX - d.sx) / k;
        const dy = (ev.clientY - d.sy) / k;
        const moved = d.moved || Math.abs(dx) + Math.abs(dy) > 2;
        nd = { ...d, moved };
        if (moved) update((b) => ({ ...b, nodes: b.nodes.map((n) => (d.orig.has(n.id) ? { ...n, x: Math.round(d.orig.get(n.id)!.x + dx), y: Math.round(d.orig.get(n.id)!.y + dy) } : n)) }));
      } else if (d.kind === 'resize') {
        const k = viewRef.current.k;
        const w = Math.max(100, Math.round(d.w + (ev.clientX - d.sx) / k));
        const h = Math.max(50, Math.round(d.h + (ev.clientY - d.sy) / k));
        update((b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === d.id ? { ...n, w, h } : n)) }));
      } else if (d.kind === 'marquee') {
        const w = toWorld(ev.clientX, ev.clientY);
        nd = { ...d, x1: w.x, y1: w.y };
      } else if (d.kind === 'line') {
        const w = toWorld(ev.clientX, ev.clientY);
        nd = { ...d, x: w.x, y: w.y };
      }
      dragRef.current = nd;
      setDrag(nd);
    };
    const up = (ev: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      if (d.kind === 'pan' && !d.moved) {
        setSel(new Set());
        setSelEdge(null);
      } else if (d.kind === 'marquee') {
        const r = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
        const hit = boardRef.current.nodes.filter((n) => n.x < r.x + r.w && n.x + n.w > r.x && n.y < r.y + r.h && n.y + n.h > r.y).map((n) => n.id);
        setSel(new Set([...d.add, ...hit]));
      } else if (d.kind === 'line') {
        const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-node]') as HTMLElement | null;
        const to = el?.dataset.node;
        if (to && to !== d.from) void connect(d.from, to);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  const onBgPointerDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0 && ev.button !== 1) return;
    wrapRef.current?.focus();
    setEditing(null);
    setEditingEdge(null);
    if (ev.shiftKey && ev.button === 0) {
      const w = toWorld(ev.clientX, ev.clientY);
      startDrag({ kind: 'marquee', x0: w.x, y0: w.y, x1: w.x, y1: w.y, add: new Set(sel) });
    } else startDrag({ kind: 'pan', sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved: false });
  };

  const onNodePointerDown = (ev: React.PointerEvent, n: BoardNode) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    wrapRef.current?.focus({ preventScroll: true });
    if (editing === n.id) return;
    setEditing(null);
    setSelEdge(null);
    if (p.lineMode) {
      const w = toWorld(ev.clientX, ev.clientY);
      startDrag({ kind: 'line', from: n.id, x: w.x, y: w.y });
      return;
    }
    let s = sel;
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
      s = new Set(sel);
      if (s.has(n.id)) s.delete(n.id);
      else s.add(n.id);
    } else if (!sel.has(n.id)) s = new Set([n.id]);
    setSel(s);
    if (n.type === 'note' && n.file) app.select(n.file);
    const orig = new Map<string, { x: number; y: number }>();
    for (const id of s) {
      const m = byId.get(id);
      if (!m) continue;
      orig.set(id, { x: m.x, y: m.y });
      if (m.type === 'group') for (const c of board.nodes) if (c.id !== m.id && inside(c, m)) orig.set(c.id, { x: c.x, y: c.y });
    }
    startDrag({ kind: 'move', sx: ev.clientX, sy: ev.clientY, orig, moved: false });
  };

  const onWheel = (ev: React.WheelEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    if (ev.ctrlKey || ev.metaKey || !ev.shiftKey) {
      const k = Math.max(0.1, Math.min(3, v.k * Math.exp(-ev.deltaY * 0.0015)));
      const mx = ev.clientX - r.left;
      const my = ev.clientY - r.top;
      setView({ k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k });
    } else setView({ ...v, x: v.x - ev.deltaY });
  };
  const zoomBy = (f: number) => {
    const el = wrapRef.current!;
    const v = viewRef.current;
    const k = Math.max(0.1, Math.min(3, v.k * f));
    const mx = el.clientWidth / 2;
    const my = el.clientHeight / 2;
    setView({ k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k });
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if ((ev.target as HTMLElement).closest('input,textarea')) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') void deleteSelection();
    else if (ev.key === 'Escape') {
      setSel(new Set());
      setSelEdge(null);
      p.setLineMode(false);
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a') setSel(new Set(board.nodes.map((n) => n.id)));
    else if (ev.key === 'Enter' && sel.size === 1) openNode(byId.get([...sel][0])!);
    else return;
    ev.preventDefault();
  };

  const openNode = (n: BoardNode) => {
    if (!n) return;
    if (n.type === 'folder' && n.file !== undefined) p.setFolder(n.file);
    else if (n.type === 'note' && n.file) app.openNote(n.file);
    else if (n.type === 'text' || n.type === 'group') setEditing(n.id);
    else if (n.type === 'link' && n.url && window.confirm(`Open in your web browser?\n\n${n.url}`)) void window.nexus.openExternal(n.url).catch((e) => app.notify(errMsg(e), true));
    else if (n.type === 'image' && n.file) app.select(n.file);
  };

  // ---------- drag & drop from tree / tool strip ----------
  const onDragOver = (ev: React.DragEvent) => {
    const t = ev.dataTransfer.types;
    if (t.includes(DRAG_MIME) || t.includes(TOOL_MIME)) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
      setDropHint(true);
    }
  };
  const onDrop = (ev: React.DragEvent) => {
    setDropHint(false);
    const at = toWorld(ev.clientX, ev.clientY);
    const tool = ev.dataTransfer.getData(TOOL_MIME);
    if (tool) {
      ev.preventDefault();
      if (tool === 'line') p.setLineMode(true);
      else void runTool(tool as ToolId, at);
      return;
    }
    const raw = ev.dataTransfer.getData(DRAG_MIME);
    if (raw) {
      ev.preventDefault();
      try {
        const d = JSON.parse(raw) as { rel: string; kind: 'file' | 'folder' };
        placeFile(d.rel, d.kind, at);
      } catch {
        /* ignore */
      }
    }
  };

  const nodeMenu = (ev: React.MouseEvent, n: BoardNode | null) => {
    ev.preventDefault();
    ev.stopPropagation();
    const at = toWorld(ev.clientX, ev.clientY);
    let items: MenuItem[];
    if (!n) {
      items = [
        { label: 'Add note card', onClick: () => void runTool('note', at), disabled: p.readOnly },
        { label: 'Add text', onClick: () => void runTool('text', at) },
        { label: 'Add box / group', onClick: () => void runTool('group', at) },
        { label: 'Add image…', onClick: () => void runTool('image', at), disabled: p.readOnly },
        { label: 'Add link card…', onClick: () => void runTool('link', at) },
        { sep: true, label: '' },
        { label: 'Zoom to fit', onClick: fit },
        { label: 'Re-layout cards in a grid', onClick: () => relayout() },
        ...(board.hidden.length ? [{ label: `Show ${board.hidden.length} removed card${board.hidden.length > 1 ? 's' : ''} again`, onClick: () => update((b) => ({ ...b, hidden: [] })) }] : []),
      ];
    } else {
      if (!sel.has(n.id)) setSel(new Set([n.id]));
      items = [
        ...(n.type === 'note' ? [{ label: 'Open note', onClick: () => openNode(n) }, { label: 'Show in graph', onClick: () => app.showInGraph(n.file!) }] : []),
        ...(n.type === 'folder' ? [{ label: 'Open folder board', onClick: () => openNode(n) }] : []),
        ...(n.type === 'text' || n.type === 'group' ? [{ label: 'Edit text', onClick: () => setEditing(n.id) }] : []),
        ...(n.type === 'link' ? [{ label: 'Open in browser', onClick: () => openNode(n) }] : []),
        { label: 'Draw line from here', onClick: () => p.setLineMode(true) },
        { sep: true, label: '' },
        ...['yellow', 'green', 'blue', 'purple', 'red', ''].map((c) => ({ label: c ? `Color: ${c}` : 'Color: none', onClick: () => update((b) => ({ ...b, nodes: b.nodes.map((m) => (sel.has(m.id) || m.id === n.id ? { ...m, color: c || undefined } : m)) })) })),
        { sep: true, label: '' },
        { label: 'Remove from board', hint: 'Del', danger: true, onClick: () => void deleteSelection() },
      ];
    }
    setMenu({ x: ev.clientX, y: ev.clientY, items });
  };

  const relayout = () => {
    const cols = gridCols();
    update((b) => {
      const placed: BoardNode[] = [];
      const order = [...b.nodes].sort((x, y) => (x.type === 'folder' ? 0 : 1) - (y.type === 'folder' ? 0 : 1));
      for (const n of order) {
        if (n.type === 'group') {
          placed.push(n);
          continue;
        }
        const pos = freeSlot(placed.filter((x) => x.type !== 'group'), n.w, n.h, cols);
        placed.push({ ...n, x: pos.x, y: pos.y });
      }
      return { ...b, nodes: placed };
    });
    setTimeout(fit, 50);
  };

  // ---------- render ----------
  const crumbs = folder ? folder.split('/') : [];
  const ordered = useMemo(() => [...board.nodes].sort((a, b) => (a.type === 'group' ? 0 : 1) - (b.type === 'group' ? 0 : 1) || (a.type === 'group' && b.type === 'group' ? b.w * b.h - a.w * a.h : 0)), [board.nodes]);

  const renderEdge = (e: RenderEdge) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return null;
    const p1 = clipToRect(a, b.x + b.w / 2, b.y + b.h / 2);
    const p2 = clipToRect(b, a.x + a.w / 2, a.y + a.h / 2);
    const on = selEdge === e.id;
    return (
      <g key={e.id} data-edge={e.id} data-ends={`${a.file ?? a.id}>${b.file ?? b.id}`} className={`edge${e.link ? ' link' : ' board'}${on ? ' on' : ''}${e.pending ? ' pending' : ''}`}>
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="vis" markerEnd={`url(#arrow${on ? '-on' : ''})`} />
        <line
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          className="hit"
          onPointerDown={(ev) => {
            ev.stopPropagation();
            wrapRef.current?.focus({ preventScroll: true });
            setSelEdge(e.id);
            setSel(new Set());
          }}
          onDoubleClick={(ev) => {
            ev.stopPropagation();
            setEditingEdge(e.id);
          }}
        >
          <title>{p.readOnly ? (e.link ? 'Import / dependency (from the code)' : 'Board-only line. Double-click to label.') : e.link ? 'Link written in the note (Delete removes the link, keeps the text). Double-click to label.' : 'Board-only line. Double-click to label.'}</title>
        </line>
      </g>
    );
  };

  const edgeLabel = (e: RenderEdge) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return null;
    if (!e.label && editingEdge !== e.id) return null;
    const mx = (a.x + a.w / 2 + b.x + b.w / 2) / 2;
    const my = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
    return (
      <div
        key={'lbl' + e.id}
        className={`elabel${selEdge === e.id ? ' on' : ''}`}
        style={{ left: mx, top: my }}
        onPointerDown={(ev) => {
          ev.stopPropagation();
          setSelEdge(e.id);
          setSel(new Set());
          wrapRef.current?.focus({ preventScroll: true });
        }}
        onDoubleClick={() => setEditingEdge(e.id)}
      >
        {editingEdge === e.id ? (
          <input
            autoFocus
            defaultValue={e.label ?? ''}
            placeholder="label"
            onBlur={(ev) => {
              setEdgeLabel(e, ev.currentTarget.value);
              setEditingEdge(null);
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') ev.currentTarget.blur();
              if (ev.key === 'Escape') setEditingEdge(null);
              ev.stopPropagation();
            }}
          />
        ) : (
          e.label
        )}
      </div>
    );
  };

  const renderNode = (n: BoardNode) => {
    const isSel = sel.has(n.id);
    const common = {
      'data-node': n.id,
      style: { left: n.x, top: n.y, width: n.w, height: n.h } as React.CSSProperties,
      onPointerDown: (ev: React.PointerEvent) => onNodePointerDown(ev, n),
      onDoubleClick: (ev: React.MouseEvent) => {
        ev.stopPropagation();
        openNode(n);
      },
      onContextMenu: (ev: React.MouseEvent) => nodeMenu(ev, n),
    };
    const handles = (
      <>
        <div
          className="rs"
          title="Resize"
          onPointerDown={(ev) => {
            ev.stopPropagation();
            startDrag({ kind: 'resize', id: n.id, sx: ev.clientX, sy: ev.clientY, w: n.w, h: n.h });
          }}
        />
        <div
          className="conn"
          title="Drag to another card to draw a line"
          onPointerDown={(ev) => {
            ev.stopPropagation();
            const w = toWorld(ev.clientX, ev.clientY);
            startDrag({ kind: 'line', from: n.id, x: w.x, y: w.y });
          }}
        />
      </>
    );
    const cls = `bnode ${n.type}${isSel ? ' sel' : ''}${n.color ? ' c-' + n.color : ''}${n.file && n.file === p.selectedRel ? ' cur' : ''}`;
    if (n.type === 'group') {
      return (
        <div {...common} className={cls}>
          <div className="ghead">
            {editing === n.id ? (
              <input
                autoFocus
                defaultValue={n.text ?? ''}
                onPointerDown={(ev) => ev.stopPropagation()}
                onBlur={(ev) => {
                  const v = ev.currentTarget.value;
                  update((b) => ({ ...b, nodes: b.nodes.map((m) => (m.id === n.id ? { ...m, text: v } : m)) }));
                  setEditing(null);
                }}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === 'Escape') ev.currentTarget.blur();
                  ev.stopPropagation();
                }}
              />
            ) : (
              n.text || 'Group'
            )}
          </div>
          {handles}
        </div>
      );
    }
    if (n.type === 'note') {
      const pv = n.file ? previews[n.file] : undefined;
      const top = n.file && n.file.includes('/') ? n.file.slice(0, n.file.indexOf('/')) : '';
      const missing = !!n.file && graphReady && !noteSet.has(n.file);
      const isCode = !!n.file && !/\.md$/i.test(n.file);
      return (
        <div {...common} className={cls + (missing ? ' missing' : '') + (isCode ? ' code' : '')} title={n.file}>
          <div className="strip" style={{ background: folderColor(top, folders) }} />
          <div className="ct">{n.file ? (isCode ? baseName(n.file) : noteTitle(n.file)) : 'Note'}</div>
          {n.file && dirOf(n.file) !== folder && <div className="cpath">{dirOf(n.file) || '/'}</div>}
          <div className="cp">{missing ? 'File not found' : pv?.preview || <span className="muted">{isCode ? '' : 'Empty note'}</span>}</div>
          {!!pv?.tags.length && (
            <div className="ctags">
              {pv.tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </div>
          )}
          {handles}
        </div>
      );
    }
    if (n.type === 'folder') {
      const list = (n.file !== undefined && kids[n.file]) || [];
      return (
        <div {...common} className={cls} title={`${n.file} — double-click to open`}>
          <div className="fhead">
            <FolderIcon /> <b>{n.file ? baseName(n.file) : 'Vault'}</b>
            <span className="muted">{list.length} items</span>
            <button className="open" onPointerDown={(ev) => ev.stopPropagation()} onClick={() => openNode(n)}>
              Open ›
            </button>
          </div>
          <div className="fkids">
            {list.slice(0, 8).map((k) => (
              <span key={k.relPath} className={k.kind}>
                {k.kind === 'folder' ? '▸ ' : ''}
                {k.name.replace(/\.md$/i, '')}
              </span>
            ))}
            {list.length > 8 && <span className="more">+{list.length - 8} more</span>}
          </div>
          {handles}
        </div>
      );
    }
    if (n.type === 'text') {
      return (
        <div {...common} className={cls}>
          {editing === n.id ? (
            <textarea
              autoFocus
              defaultValue={n.text ?? ''}
              placeholder="Type something…"
              onPointerDown={(ev) => ev.stopPropagation()}
              onBlur={(ev) => {
                const v = ev.currentTarget.value;
                update((b) => ({ ...b, nodes: b.nodes.map((m) => (m.id === n.id ? { ...m, text: v } : m)) }));
                setEditing(null);
              }}
              onKeyDown={(ev) => {
                if (ev.key === 'Escape') ev.currentTarget.blur();
                ev.stopPropagation();
              }}
            />
          ) : (
            <div className="tx">{n.text || <span className="muted">Double-click to type</span>}</div>
          )}
          {handles}
        </div>
      );
    }
    if (n.type === 'image') {
      const src = n.file ? images[n.file] : undefined;
      return (
        <div {...common} className={cls} title={n.file}>
          {src && src.startsWith('data:') ? (
            <img src={src} alt={n.file} draggable={false} />
          ) : (
            <div className="imgph">
              <ImageIcon /> {src === 'error' ? 'Image not found' : 'Loading…'}
            </div>
          )}
          {handles}
        </div>
      );
    }
    // link
    let host = n.url ?? '';
    try {
      host = new URL(n.url ?? '').host;
    } catch {
      /* keep */
    }
    return (
      <div {...common} className={cls} title={`${n.url} — double-click to open in your browser`}>
        <div className="lhost">🔗 {host}</div>
        <div className="lurl">{n.url}</div>
        {handles}
      </div>
    );
  };

  const lineFrom = drag?.kind === 'line' ? byId.get(drag.from) : undefined;
  const marquee = drag?.kind === 'marquee' ? drag : null;

  return (
    <section className="pane" style={{ flex: 1 }} data-pane="board">
      <div className="panehead">
        <BoardIcon size={13} />
        <b>Board</b>
        <nav className="crumbs">
          <button onClick={() => p.setFolder('')} className={folder ? '' : 'cur'}>
            {app.vault.name}
          </button>
          {crumbs.map((c, i) => (
            <span key={i}>
              <span className="sep">›</span>
              <button className={i === crumbs.length - 1 ? 'cur' : ''} onClick={() => p.setFolder(crumbs.slice(0, i + 1).join('/'))}>
                {c}
              </button>
            </span>
          ))}
        </nav>
        <div className="r">
          {folder && (
            <button className="chipbtn" onClick={() => p.setFolder(dirOf(folder))} title="Up one level">
              ↑ Up
            </button>
          )}
          <MaxBtn single={p.view === 'board'} onMax={p.onMax} />
        </div>
      </div>
      <div
        className={`canvas board${p.lineMode ? ' linemode' : ''}${dropHint ? ' drophint' : ''}${drag?.kind === 'pan' && drag.moved ? ' panning' : ''}`}
        ref={wrapRef}
        tabIndex={0}
        data-testid="board-canvas"
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${18 * view.k}px ${18 * view.k}px` }}
        onPointerDown={onBgPointerDown}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onDragOver={onDragOver}
        onDragLeave={() => setDropHint(false)}
        onDrop={onDrop}
        onContextMenu={(ev) => nodeMenu(ev, null)}
      >
        <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="edges" width="1" height="1">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="ah" />
              </marker>
              <marker id="arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
              </marker>
            </defs>
            {edges.map((e) => (
              <Fragment key={e.id}>{renderEdge(e)}</Fragment>
            ))}
            {lineFrom && drag?.kind === 'line' && (
              <line className="tmpline" x1={lineFrom.x + lineFrom.w / 2} y1={lineFrom.y + lineFrom.h / 2} x2={drag.x} y2={drag.y} markerEnd="url(#arrow-on)" />
            )}
          </svg>
          {ordered.map((n) => (
            <Fragment key={n.id}>{renderNode(n)}</Fragment>
          ))}
          {edges.map((e) => (
            <Fragment key={'l' + e.id}>{edgeLabel(e)}</Fragment>
          ))}
          {marquee && <div className="marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />}
        </div>
        {file && entries && board.nodes.length === 0 && (
          <div className="placeholder" style={{ pointerEvents: 'none' }}>
            <BoardIcon size={34} />
            <h3>This folder has no notes yet</h3>
            <div>Use the tool strip (click or drag) or drag notes here from the tree.</div>
          </div>
        )}
        {!file && (
          <div className="placeholder">
            <div className="spin" />
          </div>
        )}
        {p.lineMode && <div className="modehint">Line tool: drag from one card to another · Esc to stop</div>}
        <div className="zoombar" onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={() => zoomBy(1 / 1.2)} title="Zoom out">−</button>
          <span>{Math.round(view.k * 100)}%</span>
          <button onClick={() => zoomBy(1.2)} title="Zoom in">+</button>
          <button onClick={fit} title="Zoom to fit">⤢</button>
        </div>
        <div className="boardhint">Drag empty space to pan · Shift+drag to select · Wheel to zoom · Del removes</div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </section>
  );
}
