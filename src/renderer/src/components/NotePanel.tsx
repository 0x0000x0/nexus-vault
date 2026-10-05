// Note viewer/editor + backlinks/outgoing/tags panel (Grok Bot).
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FsChange, NoteFile, NoteInfo } from '../../../shared/types';
import { baseName, errMsg, noteTitle, useApp } from '../ctx';
import { highlight } from '../highlight';

interface Props {
  rel: string | null;
  editRequest: number; // bump to switch into edit mode
  width: number;
  onClose: () => void;
  readOnly?: boolean;
}

marked.setOptions({ gfm: true, breaks: false });

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Markdown -> sanitized HTML; [[links]] become clickable anchors with data-wikilink. */
function render(md: string): string {
  const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---\s*\n?/, (fm) => '```yaml\n' + fm.replace(/^---\r?\n|\r?\n---\s*\n?$/g, '') + '\n```\n');
  const withLinks = body.replace(/(!?)\[\[([^\[\]\n]+?)\]\]/g, (_m, bang: string, inner: string) => {
    const pipe = inner.indexOf('|');
    const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).split('#')[0].trim();
    const label = pipe >= 0 ? inner.slice(pipe + 1) : inner;
    return `<a class="wl${bang ? ' embed' : ''}" data-wikilink="${esc(target)}">${esc(label)}</a>`;
  });
  const html = marked.parse(withLinks, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-wikilink'], FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'img'] });
}

export function NotePanel({ rel, editRequest, width, onClose, readOnly }: Props) {
  const app = useApp();
  const [file, setFile] = useState<NoteFile | null>(null);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [info, setInfo] = useState<NoteInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [external, setExternal] = useState(false);
  const dirty = !!file && text !== file.content;
  const stateRef = useRef({ file, text, dirty });
  stateRef.current = { file, text, dirty };

  const load = useCallback(async (r: string) => {
    try {
      const f = await window.nexus.readNote(r);
      setFile(f);
      setText(f.content);
      setErr(null);
      setExternal(false);
    } catch (e) {
      setFile(null);
      setText('');
      setErr(errMsg(e));
    }
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    const { file: f, text: t, dirty: d } = stateRef.current;
    if (!f || !d || readOnly) return true;
    try {
      const nf = await window.nexus.writeNote(f.rel, t, f.mtimeMs);
      setFile(nf);
      setExternal(false);
      setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      return true;
    } catch (e) {
      const m = errMsg(e);
      if (m.startsWith('CONFLICT') && window.confirm('This note was changed outside Nexus Vault since you opened it.\n\nOverwrite it with your version? (The other version is backed up in .nexus-backups.)')) {
        const nf = await window.nexus.writeNote(f.rel, t);
        setFile(nf);
        setExternal(false);
        return true;
      }
      app.notify(m, true);
      return false;
    }
  }, [app, readOnly]);

  // Switch notes: save the previous one first.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await save();
      if (cancelled) return;
      setSavedAt(null);
      if (rel) await load(rel);
      else {
        setFile(null);
        setText('');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rel]);

  useEffect(() => {
    if (editRequest > 0 && !readOnly) setMode('edit');
  }, [editRequest, readOnly]);

  // Backlinks etc. refresh whenever the index changes.
  useEffect(() => {
    if (!rel) {
      setInfo(null);
      return;
    }
    let live = true;
    void window.nexus.getNoteInfo(rel).then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [rel, app.indexVersion]);

  // External edits (Obsidian, Explorer) reload the note if we have no unsaved changes.
  useEffect(
    () =>
      window.nexus.onFsChanged((c: FsChange) => {
        const { file: f, dirty: d } = stateRef.current;
        if (!f || !c.files.includes(f.rel)) return;
        void window.nexus
          .readNote(f.rel)
          .then((nf) => {
            if (nf.content === stateRef.current.file?.content) {
              setFile((cur) => (cur ? { ...cur, mtimeMs: nf.mtimeMs } : cur));
              return;
            }
            if (!d) {
              setFile(nf);
              setText(nf.content);
            } else setExternal(true);
          })
          .catch(() => setErr('This note was moved or deleted.'));
      }),
    [],
  );

  const ext = rel ? (rel.split('.').pop() ?? '').toLowerCase() : '';
  const isMd = ext === 'md';
  const codeLines = 6000;
  const html = useMemo(() => {
    if (mode !== 'preview') return '';
    if (isMd || !rel) return render(text);
    const lines = text.split(/\r?\n/);
    const shown = lines.slice(0, codeLines).join('\n');
    return highlight(shown, ext);
  }, [mode, text, isMd, ext, rel]);
  const lineCount = useMemo(() => (isMd ? 0 : Math.min(codeLines, text.split(/\r?\n/).length)), [isMd, text]);

  const onPreviewClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const wl = a.getAttribute('data-wikilink');
    if (wl !== null && rel) {
      const out = info?.outgoing.find((o) => o.resolved && noteTitle(o.target).toLowerCase() === wl.split('/').pop()!.toLowerCase());
      if (out) app.openNote(out.target);
      else app.notify(`"${wl}" does not exist yet.`);
      return;
    }
    const href = a.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href) && window.confirm(`Open in your web browser?\n\n${href}`)) void window.nexus.openExternal(href);
  };

  return (
    <aside className="notepanel" style={{ width }} data-testid="note-panel">
      <div className="panehead">
        <b className="ttl" title={rel ?? ''}>{rel ? (isMd ? noteTitle(rel) : baseName(rel)) : 'Note'}</b>
        {readOnly && rel && <span className="badge">read-only</span>}
        {dirty && <span className="dirty" title="Unsaved changes">●</span>}
        {savedAt && !dirty && <span className="saved">Saved {savedAt}</span>}
        <div className="r">
          {rel && (
            <div className="seg sm">
              <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>
                Preview
              </button>
              <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')} disabled={readOnly} title={readOnly ? 'Read-only' : 'Edit (Markdown)'}>
                Edit
              </button>
            </div>
          )}
          {rel && !readOnly && (
            <button className="chipbtn on" disabled={!dirty} onClick={() => void save()} title="Save (Ctrl+S). A backup of the previous version goes to .nexus-backups">
              Save
            </button>
          )}
          <button className="iconbtn" title="Close panel" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
      {!rel ? (
        <div className="npempty">Click a note in the tree, graph or board to open it here.</div>
      ) : err ? (
        <div className="npempty">{err}</div>
      ) : (
        <>
          {external && (
            <div className="npwarn">
              Changed on disk by another app.{' '}
              <button className="linkbtn" onClick={() => void load(rel)}>
                Reload (discard mine)
              </button>
            </div>
          )}
          <div className="npbody">
            {mode === 'edit' ? (
              <textarea
                className="editor"
                value={text}
                spellCheck={false}
                autoFocus
                onChange={(e) => setText(e.target.value)}
                onBlur={() => void save()}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    void save();
                  } else if (e.key === 'Tab') {
                    e.preventDefault();
                    const el = e.currentTarget;
                    const s = el.selectionStart;
                    setText(text.slice(0, s) + '  ' + text.slice(el.selectionEnd));
                    requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
                  }
                }}
              />
            ) : (
              isMd ? (
                <div className="md" onClick={onPreviewClick} onDoubleClick={() => !readOnly && setMode('edit')} dangerouslySetInnerHTML={{ __html: html }} />
              ) : (
                <div className="codeview">
                  <pre className="gutter" aria-hidden="true">{Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}</pre>
                  <pre className="src" dangerouslySetInnerHTML={{ __html: html }} />
                </div>
              )
            )}
          </div>
          <div className="nplinks">
            <details open>
              <summary>{readOnly ? 'Used by' : 'Backlinks'} ({info?.backlinks.length ?? 0})</summary>
              {info?.backlinks.length ? (
                info.backlinks.map((b) => (
                  <div key={b.rel} className="bl" onClick={() => app.openNote(b.rel)} title={b.rel}>
                    <div className="blt">{b.title}</div>
                    {b.context && <div className="blc">{b.context}</div>}
                  </div>
                ))
              ) : (
                <div className="muted">{readOnly ? 'Nothing imports this file.' : 'No notes link here yet.'}</div>
              )}
            </details>
            <details>
              <summary>{readOnly ? 'Imports' : 'Outgoing links'} ({info?.outgoing.length ?? 0})</summary>
              {info?.outgoing.map((o) => (
                <div key={o.target} className={`bl${o.resolved ? '' : ' ghost'}`} onClick={() => (o.resolved ? app.openNote(o.target) : app.notify(readOnly ? `${o.title} is outside this repo.` : `"${o.title}" does not exist yet.`))}>
                  <div className="blt">{o.title}</div>
                </div>
              ))}
            </details>
            {!!info?.tags.length && (
              <div className="tags">
                {info.tags.map((t) => (
                  <span key={t} className="tag">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
