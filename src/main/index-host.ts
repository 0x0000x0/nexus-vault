// 0.0.9 speed: utilityProcess entry for the index (see index-host-core.ts). Grok Bot.
import { createIndexHost, type HostIn } from './index-host-core';

const port = (process as unknown as { parentPort: { on: (ev: 'message', f: (e: { data: HostIn }) => void) => void; postMessage: (m: unknown) => void } }).parentPort;
const onMsg = createIndexHost((m) => port.postMessage(m));
port.on('message', (e) => void onMsg(e.data));
process.on('uncaughtException', (e) => port.postMessage({ t: 'log', tag: 'index-host', msg: 'uncaught exception', err: String(e?.stack ?? e) }));
process.on('unhandledRejection', (e) => port.postMessage({ t: 'log', tag: 'index-host', msg: 'unhandled rejection', err: String((e as Error)?.stack ?? e) }));
