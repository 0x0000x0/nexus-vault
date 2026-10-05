import crypto from 'node:crypto';

export interface McpBackend {
  search(q: string, limit: number): { rel: string; title: string; folder: string; snippet: string; score: number; startLine?: number; source?: string }[];
  listNotes(): { rel: string; title: string }[];
  readNote(rel: string): Promise<string>;
  backlinks(rel: string): { rel: string; title: string; context: string }[];
  appendNote?(rel: string, text: string): Promise<void>;
  createNote?(dir: string, name: string, content: string): Promise<string>;
}

export function checkRequest(
  h: { host?: string; origin?: string; authorization?: string },
  remoteAddress: string | undefined,
  token: string,
  port: number,
): { ok: true } | { ok: false; status: number; error: string } {
  if (token === '') {
    return { ok: false, status: 401, error: 'missing token' };
  }

  const validAddrs = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if (!validAddrs.includes(remoteAddress ?? '')) {
    return { ok: false, status: 403, error: 'forbidden: invalid remote address' };
  }

  const expectedHosts: string[] = [];
  if (port >= 1024 && port <= 65535) {
    expectedHosts.push(`127.0.0.1:${port}`);
  }
  expectedHosts.push(`localhost:${port}`);

  if (!expectedHosts.includes(h.host ?? '')) {
    return { ok: false, status: 403, error: 'forbidden: invalid host' };
  }

  if (h.origin !== undefined) {
    return { ok: false, status: 403, error: 'forbidden: origin header present' };
  }

  const expectedAuth = `Bearer ${token}`;
  if (h.authorization === undefined) {
    return { ok: false, status: 401, error: 'missing or malformed authorization' };
  }

  const authHeaderBuf = Buffer.from(h.authorization);
  const authExpectedBuf = Buffer.from(expectedAuth);
  if (authExpectedBuf.length !== authHeaderBuf.length) {
    return { ok: false, status: 401, error: 'missing or malformed authorization' };
  }

  if (!crypto.timingSafeEqual(authExpectedBuf, authHeaderBuf)) {
    return { ok: false, status: 401, error: 'missing or malformed authorization' };
  }

  return { ok: true };
}

export function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function makeToolResult(hits: any[]): any {
  const items: any[] = [];
  for (const h of hits) {
    const cite = `[${h.title}](${encodeURI(h.rel)}${h.startLine ? `#L${h.startLine}` : ''})`;
    items.push({
      type: 'text',
      text: JSON.stringify({ path: h.rel, title: h.title, folder: h.folder, snippet: h.snippet, score: h.score, ...(h.startLine ? { startLine: h.startLine } : {}), ...(h.source ? { source: h.source } : {}), cite }),
    });
  }
  return items;
}

export async function handleRpc(
  msg: any,
  backend: McpBackend,
  opts: { readOnly: boolean; vaultName: string },
): Promise<object | null> {
  const method = msg.method;
  const id = msg.id;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'nexus-vault', version: opts.vaultName || '0.0.4' },
      },
    };
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: 'pong' };
  }

  if (method === 'tools/list') {
    if (opts.readOnly) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'search',
              description: 'Search notes (keyword + local semantic if enabled). Each hit is a source with path, title, snippet, startLine and a ready-made markdown `cite` link — cite sources in answers.',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                  limit: { type: 'integer', minimum: 1 },
                },
                required: ['query'],
              },
            },
            {
              name: 'get_note',
              description: 'Read a note',
              inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            },
            {
              name: 'list_notes',
              description: 'List notes',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'backlinks',
              description: 'Get backlinks',
              inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            },
          ],
        },
      };
    }
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'search',
            description: 'Search notes (keyword + local semantic if enabled). Each hit is a source with path, title, snippet, startLine and a ready-made markdown `cite` link — cite sources in answers.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                limit: { type: 'integer', minimum: 1 },
              },
            },
          },
          {
            name: 'get_note',
            description: 'Read a note',
            inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
          },
          {
            name: 'list_notes',
            description: 'List notes',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'backlinks',
            description: 'Get backlinks',
            inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
          },
          {
            name: 'append_note',
            description: 'Append to a note',
            inputSchema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } } },
          },
          {
            name: 'create_note',
            description: 'Create a note',
            inputSchema: { type: 'object', properties: { folder: { type: 'string' }, name: { type: 'string' }, content: { type: 'string' } } },
          },
        ],
      },
    };
  }

  if (method === 'tools/call') {
    const params = msg.params;
    const name = params?.name;
    const arguments_ = params?.arguments;

    if (opts.readOnly) {
      if (name === 'search') {
        const query = typeof arguments_?.query === 'string' ? arguments_.query : '';
        const limit = typeof arguments_?.limit === 'number' ? Math.max(1, arguments_.limit) : 10;
        const hits = backend.search(query, limit);
        return {
          jsonrpc: '2.0',
          id,
          result: { content: makeToolResult(hits) },
        };
      }
      if (name === 'get_note') {
        const path = typeof arguments_?.path === 'string' ? arguments_.path : '';
        try {
          const content = await backend.readNote(path);
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: content }] },
          };
        } catch (e: any) {
          return { jsonrpc: '2.0', id, error: { code: -32603, message: e.message } };
        }
      }
      if (name === 'list_notes') {
        const notes = backend.listNotes();
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(notes.map((n: any) => ({ rel: n.rel, title: n.title }))) }],
          },
        };
      }
      if (name === 'backlinks') {
        const path = typeof arguments_?.path === 'string' ? arguments_.path : '';
        try {
          const bl = await backend.backlinks(path);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(bl.map((b: any) => ({ rel: b.rel, title: b.title, context: b.context }))) }],
            },
          };
        } catch (e: any) {
          return { jsonrpc: '2.0', id, error: { code: -32603, message: e.message } };
        }
      }
      if (name === 'append_note' || name === 'create_note') {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: 'Vault is read-only for AI access' },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'Method not found' },
      };
    }

    if (name === 'search') {
      const query = typeof arguments_?.query === 'string' ? arguments_.query : '';
      const limit = typeof arguments_?.limit === 'number' ? Math.max(1, arguments_.limit) : 10;
      const hits = backend.search(query, limit);
      return {
        jsonrpc: '2.0',
        id,
        result: { content: makeToolResult(hits) },
      };
    }
    if (name === 'get_note') {
      const path = typeof arguments_?.path === 'string' ? arguments_.path : '';
      try {
        const content = await backend.readNote(path);
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: content }] },
        };
      } catch (e: any) {
        return { jsonrpc: '2.0', id, error: { code: -32603, message: e.message } };
      }
    }
    if (name === 'list_notes') {
      const notes = backend.listNotes();
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(notes.map((n: any) => ({ rel: n.rel, title: n.title }))) }],
        },
      };
    }
    if (name === 'backlinks') {
      const path = typeof arguments_?.path === 'string' ? arguments_.path : '';
      try {
        const bl = await backend.backlinks(path);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(bl.map((b: any) => ({ rel: b.rel, title: b.title, context: b.context }))) }],
          },
        };
      } catch (e: any) {
        return { jsonrpc: '2.0', id, error: { code: -32603, message: e.message } };
      }
    }
    if (name === 'append_note') {
      const path = typeof arguments_?.path === 'string' ? arguments_.path : '';
      const text = typeof arguments_?.text === 'string' ? arguments_.text : '';
      try {
        await backend.appendNote!(path, text);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'ok' }] } };
      } catch (e: any) {
        return { jsonrpc: '2.0', id, error: { code: -32603, message: e.message } };
      }
    }
    if (name === 'create_note') {
      const folder = typeof arguments_.folder === 'string' ? arguments_.folder : '';
      const name = typeof arguments_.name === 'string' ? arguments_.name : '';
      const content = typeof arguments_.content === 'string' ? arguments_.content : '';
      try {
        const rel = await backend.createNote!(folder, name, content);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: rel }] } };
      } catch (e: any) {
        return { jsonrpc: '2.0', id, error: { code: -32603, message: e.message } };
      }
    }
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Method not found' },
    };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: 'Method not found' },
  };
}