// 0.0.9 speed: the notes/code index runs in its own process (Electron utilityProcess) so the main process never
// blocks on reading, parsing or full-text indexing. This is the transport-free core (also used in tests). Grok Bot.
import type { FsChange, IndexStats } from '../shared/types';
import { VaultIndex } from './indexer';
import { CodeIndex } from './codeindex';
import { hasLinkTo, linkNameFor, removeLinkText } from './parse';
import { setIndexLogSink } from './index-log';

export type HostIn =
  | { t: 'start'; id: number; mode: 'notes' | 'code'; root: string; cacheFile: string | null }
  | { t: 'call'; id: number; m: string; a: unknown[] };
export type HostOut =
  | { t: 'res'; id: number; r: unknown }
  | { t: 'err'; id: number; e: string }
  | { t: 'change'; stats: IndexStats; fsChange: FsChange }
  | { t: 'progress'; label: string; done: number; total: number }
  | { t: 'note'; rel: string; note: { title: string; content: string } | null }
  | { t: 'ready'; stats: IndexStats; info: unknown }
  | { t: 'log'; tag: string; msg: string; err?: string };

/** Methods the main process may call (anything else is refused). */
const CALLS = new Set([
  'search',
  'listNotes',
  'noteInfo',
  'graph',
  'links',
  'previews',
  'stats',
  'touch',
  'touchDir',
  'allNotes',
  'noteContents',
  'rels',
  'importEdges',
  'externalPackages',
  'hasLinkTo',
  'linkNameFor',
  'removeLinkText',
  'setNoteEvents',
  'saveCache',
  'close',
]);

export function createIndexHost(post: (m: HostOut) => void): (m: HostIn) => Promise<void> {
  let idx: VaultIndex | CodeIndex | null = null;
  setIndexLogSink((tag, msg, err) => post({ t: 'log', tag, msg, err: err === undefined ? undefined : err instanceof Error ? err.stack ?? err.message : String(err) }));
  const local: Record<string, (...a: never[]) => unknown> = {
    noteContents: (rels: string[]) => {
      const out: Record<string, string> = {};
      if (idx instanceof VaultIndex) for (const r of rels) {
        const c = idx.noteContent(r);
        if (c !== undefined) out[r] = c;
      }
      return out;
    },
    hasLinkTo: (text: string, src: string, target: string) => (idx instanceof VaultIndex ? hasLinkTo(text, src, target, idx.byName, idx.byPath) : false),
    linkNameFor: (target: string) => (idx instanceof VaultIndex ? linkNameFor(target, idx.byName) : target),
    removeLinkText: (text: string, src: string, target: string) => (idx instanceof VaultIndex ? removeLinkText(text, src, target, idx.byName, idx.byPath) : text),
    setNoteEvents: (on: boolean) => {
      if (idx instanceof VaultIndex) idx.onNote = on ? (rel, note) => post({ t: 'note', rel, note }) : null;
    },
    saveCache: () => (idx instanceof VaultIndex ? idx.saveCache() : undefined),
  };
  return async (m) => {
    try {
      if (m.t === 'start') {
        if (idx) await idx.close();
        const onChange = (stats: IndexStats, fsChange: FsChange) => post({ t: 'change', stats, fsChange });
        const i: VaultIndex | CodeIndex =
          m.mode === 'code'
            ? new CodeIndex(m.root, onChange, (label, done, total) => post({ t: 'progress', label, done, total }))
            : new VaultIndex(m.root, onChange, m.cacheFile);
        idx = i;
        await i.start();
        if (idx === i) post({ t: 'ready', stats: i.stats(), info: i instanceof VaultIndex ? i.startInfo : null });
        post({ t: 'res', id: m.id, r: null });
        return;
      }
      if (!CALLS.has(m.m)) throw new Error(`index host: unknown call ${m.m}`);
      let r: unknown;
      if (m.m in local) r = await local[m.m](...(m.a as never[]));
      else {
        const fn = idx ? (idx as unknown as Record<string, unknown>)[m.m] : undefined;
        r = typeof fn === 'function' ? await (fn as (...a: unknown[]) => unknown).apply(idx, m.a) : undefined;
      }
      if (m.m === 'close') idx = null;
      post({ t: 'res', id: m.id, r: r === undefined ? null : r });
    } catch (e) {
      post({ t: 'err', id: m.id, e: e instanceof Error ? e.message : String(e) });
    }
  };
}
