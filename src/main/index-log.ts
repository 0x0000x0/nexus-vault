// 0.0.9: warnings from the index classes. They run in the index process (no Electron app/dialog there),
// so they report through a pluggable sink: the host forwards to the main-process logger. Grok Bot.
type Sink = (tag: string, msg: string, err?: unknown) => void;
let sink: Sink = (tag, msg, err) => console.warn(`[${tag}] ${msg}`, err ?? '');
export function setIndexLogSink(s: Sink): void {
  sink = s;
}
export function logWarn(tag: string, msg: string, err?: unknown): void {
  sink(tag, msg, err);
}
