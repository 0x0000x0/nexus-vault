// Localhost MCP HTTP server (127.0.0.1 only). Grok Bot.
import { createServer, type Server } from 'node:http';
import { checkRequest, handleRpc, newToken, type McpBackend } from './mcp-core';
import { logError } from './logger';

export { newToken };

let server: Server | null = null;
let currentToken = '';
let currentReadOnly = true;
let currentPort = 27124;
let lastError: string | undefined;

export function mcpStatus(): {
  enabled: boolean;
  running: boolean;
  port: number;
  readOnly: boolean;
  token: string;
  url: string;
  error?: string;
} {
  return {
    enabled: !!server,
    running: !!server,
    port: currentPort,
    readOnly: currentReadOnly,
    token: currentToken,
    url: `http://127.0.0.1:${currentPort}/mcp`,
    error: lastError,
  };
}

export function stopMcp(): void {
  if (server) {
    try {
      server.close();
    } catch {
      /* ignore */
    }
    server = null;
  }
  currentToken = '';
  lastError = undefined;
}

export function startMcp(
  backendFactory: () => McpBackend,
  settings: { enabled: boolean; port: number; token: string; readOnly: boolean },
): void {
  stopMcp();
  if (!settings.enabled) return;
  const port = settings.port || 27124;
  const token = settings.token || newToken();
  currentToken = token;
  currentReadOnly = settings.readOnly !== false;
  currentPort = port;
  lastError = undefined;

  server = createServer(async (req, res) => {
    try {
      if (req.url !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      if (req.method === 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > 1_000_000) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large' }));
          return;
        }
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks).toString('utf8');

      const check = checkRequest(
        {
          host: req.headers.host,
          origin: req.headers.origin as string | undefined,
          authorization: req.headers.authorization,
        },
        req.socket.remoteAddress,
        token,
        port,
      );
      if (!check.ok) {
        res.writeHead(check.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: check.error }));
        return;
      }

      let msg: unknown;
      try {
        msg = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const backend = backendFactory();
      if (Array.isArray(msg)) {
        const out = [];
        for (const m of msg) {
          const r = await handleRpc(m, backend, { readOnly: currentReadOnly, vaultName: 'nexus-vault' });
          if (r !== null) out.push(r);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      } else {
        const r = await handleRpc(msg, backend, { readOnly: currentReadOnly, vaultName: 'nexus-vault' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      logError('mcp', 'request failed', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  });

  server.listen(port, '127.0.0.1', () => {
    /* listening */
  });
  server.on('error', (e) => {
    lastError = e instanceof Error ? e.message : String(e);
    logError('mcp', `server error on 127.0.0.1:${port}`, e);
    server = null;
  });
}
