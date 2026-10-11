// 0.0.9 speed: main-process side of the index process. Async calls, events, and a small mirror of state. Grok Bot.
import type { FsChange, GraphData, GraphOpts, IndexStats, NoteInfo, SearchHit } from '../shared/types';
import type { HostIn, HostOut } from './index-host-core';

export interface HostTransport {
  post(m: HostIn): void;
  onMessage(f: (m: HostOut) => void): void;
  kill(): void;
}

export interface IndexEvents {
  onChange(stats: IndexStats, fsChange: FsChange): void;
  onProgress?(label: string, done: number, total: number): void;
  onReady?(stats: IndexStats, info: unknown): void;
  onLog?(tag: string, msg: string, err?: string): void;
}

export class IndexClient {
  ready = false;
  /** search index built and start() finished */
  started = false;
  lastStats: IndexStats | null = null;
  onNote: ((rel: string, note: { title: string; content: string } | null) => void) | null = null;
  private seq = 0;
  private waiting = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
  private dead = false;

  constructor(
    readonly mode: 'notes' | 'code',
    readonly root: string,
    private tr: HostTransport,
    private ev: IndexEvents,
  ) {
    tr.onMessage((m) => this.onMessage(m));
  }

  private onMessage(m: HostOut): void {
    if (this.dead) return;
    if (m.t === 'res' || m.t === 'err') {
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      if (m.t === 'res') w.res(m.r);
      else w.rej(new Error(m.e));
    } else if (m.t === 'change') {
      this.ready = true;
      this.lastStats = m.stats;
      this.ev.onChange(m.stats, m.fsChange);
    } else if (m.t === 'progress') this.ev.onProgress?.(m.label, m.done, m.total);
    else if (m.t === 'note') this.onNote?.(m.rel, m.note);
    else if (m.t === 'log') this.ev.onLog?.(m.tag, m.msg, m.err);
    else if (m.t === 'ready') {
      this.started = true;
      this.lastStats = m.stats;
      this.ev.onReady?.(m.stats, m.info);
    }
  }

  private send<T>(m: Omit<HostIn, 'id'> & { t: HostIn['t'] }): Promise<T> {
    if (this.dead) return Promise.reject(new Error('Index is closed'));
    const id = ++this.seq;
    return new Promise<T>((res, rej) => {
      this.waiting.set(id, { res: res as (v: unknown) => void, rej });
      this.tr.post({ ...(m as HostIn), id });
    });
  }
  call<T>(m: string, ...a: unknown[]): Promise<T> {
    return this.send<T>({ t: 'call', m, a } as Omit<HostIn, 'id'> & { t: 'call' });
  }

  start(cacheFile: string | null): Promise<void> {
    return this.send({ t: 'start', mode: this.mode, root: this.root, cacheFile } as Omit<HostIn, 'id'> & { t: 'start' });
  }

  search = (q: string, limit?: number) => this.call<SearchHit[]>('search', q, limit);
  listNotes = () => this.call<{ rel: string; title: string }[]>('listNotes').then((r) => r ?? []);
  noteInfo = (rel: string) => this.call<NoteInfo | null>('noteInfo', rel);
  graph = (o: GraphOpts) => this.call<GraphData>('graph', o);
  links = (among?: string[]) => this.call<[string, string][]>('links', among).then((r) => r ?? []);
  previews = (rels: string[]) => this.call<Record<string, { preview: string; tags: string[] }>>('previews', rels).then((r) => r ?? {});
  stats = () => this.call<IndexStats>('stats');
  allNotes = () => this.call<{ rel: string; title: string; content: string }[]>('allNotes').then((r) => r ?? []);
  noteContents = (rels: string[]) => this.call<Record<string, string>>('noteContents', rels);
  rels = () => this.call<string[]>('rels');
  importEdges = () => this.call<unknown>('importEdges');
  externalPackages = () => this.call<unknown>('externalPackages');
  hasLinkTo = (text: string, src: string, target: string) => this.call<boolean>('hasLinkTo', text, src, target);
  linkNameFor = (target: string) => this.call<string>('linkNameFor', target);
  removeLinkText = (text: string, src: string, target: string) => this.call<string>('removeLinkText', text, src, target);
  setNoteEvents = (on: boolean) => this.call<void>('setNoteEvents', on);
  /** Fire-and-forget: our own writes/renames, so the index updates right away. */
  touch(rel: string, kind: 'upsert' | 'remove' = 'upsert'): void {
    void this.call('touch', rel, kind).catch(() => undefined);
  }
  touchDir(rel: string): void {
    void this.call('touchDir', rel).catch(() => undefined);
  }

  async close(): Promise<void> {
    if (this.dead) return;
    try {
      await Promise.race([this.call('close'), new Promise((r) => setTimeout(r, 3000))]);
    } catch {
      /* host gone */
    }
    this.dead = true;
    for (const w of this.waiting.values()) w.rej(new Error('Index is closed'));
    this.waiting.clear();
    this.tr.kill();
  }
}
