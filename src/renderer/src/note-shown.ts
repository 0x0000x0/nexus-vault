// 0.0.9: "note first, then the rest". NotePanel reports when a note's content has been committed;
// callers (Ctrl+K Enter) defer secondary UI (Sources panel, graph camera) until just after it painted. Grok Bot.
let shown: string | null = null;
const waiters = new Map<string, Set<() => void>>();

/** Run fn on the frame after `rel` is painted (fallback after maxMs, e.g. if the note panel is closed). */
export function afterNoteShown(rel: string, fn: () => void, maxMs = 250): void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    window.clearTimeout(t);
    waiters.get(rel)?.delete(run);
    fn();
  };
  const t = window.setTimeout(run, maxMs);
  if (shown === rel) {
    requestAnimationFrame(() => window.setTimeout(run, 0));
    return;
  }
  let set = waiters.get(rel);
  if (!set) waiters.set(rel, (set = new Set()));
  set.add(run);
}

/** Called by NotePanel after a note's content was committed to the DOM. */
export function noteShown(rel: string | null): void {
  shown = rel;
  if (!rel) return;
  const set = waiters.get(rel);
  if (!set?.size) return;
  waiters.delete(rel);
  // next frame = after the browser painted the note
  requestAnimationFrame(() => window.setTimeout(() => set.forEach((f) => f()), 0));
}
