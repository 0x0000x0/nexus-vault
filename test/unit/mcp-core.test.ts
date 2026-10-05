// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { checkRequest, handleRpc, newToken, type McpBackend } from '../../src/main/mcp-core';

const token = 'test-token-abc123456789012345678901234';

const fakeBackend: McpBackend = {
  search: (q, limit) => [
    { rel: 'a.md', title: 'A', folder: '', snippet: `snippet about ${q}`, score: 1 },
  ].slice(0, limit),
  listNotes: () => [{ rel: 'a.md', title: 'A' }],
  readNote: async () => 'hello',
  backlinks: () => [],
  appendNote: async () => {},
  createNote: async () => 'new.md',
};

describe('mcp-core', () => {
  describe('checkRequest', () => {
    const good = { host: '127.0.0.1:27124', authorization: `Bearer ${token}` };
    it('rejects missing token', () => {
      expect(checkRequest({ host: '127.0.0.1:27124' }, '127.0.0.1', token, 27124).ok).toBe(false);
      expect(checkRequest({ host: '127.0.0.1:27124' }, '127.0.0.1', token, 27124).status).toBe(401);
    });
    it('rejects wrong token', () => {
      const r = checkRequest({ host: '127.0.0.1:27124', authorization: 'Bearer wrong' }, '127.0.0.1', token, 27124);
      expect(r.ok).toBe(false);
      expect(r.status).toBe(401);
    });
    it('accepts good token', () => {
      expect(checkRequest(good, '127.0.0.1', token, 27124).ok).toBe(true);
    });
    it('rejects bad host', () => {
      const r = checkRequest({ host: 'evil.com:27124', authorization: `Bearer ${token}` }, '127.0.0.1', token, 27124);
      expect(r.ok).toBe(false);
      expect(r.status).toBe(403);
    });
    it('rejects Origin', () => {
      const r = checkRequest({ ...good, origin: 'https://evil' }, '127.0.0.1', token, 27124);
      expect(r.ok).toBe(false);
      expect(r.status).toBe(403);
    });
    it('rejects remote 10.0.0.5', () => {
      const r = checkRequest(good, '10.0.0.5', token, 27124);
      expect(r.ok).toBe(false);
      expect(r.status).toBe(403);
    });
  });

  describe('handleRpc', () => {
    it('initialize', async () => {
      const result = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, fakeBackend, {
        readOnly: true,
        vaultName: '0.0.4',
      });
      expect(result.result.protocolVersion).toBe('2025-06-18');
      expect(result.result.serverInfo.name).toBe('nexus-vault');
    });
    it('tools/list readOnly hides write tools', async () => {
      const result = await handleRpc({ method: 'tools/list', id: 3 }, fakeBackend, { readOnly: true, vaultName: '0.0.4' });
      const names = (result.result.tools || []).map((t) => t.name);
      expect(names).toContain('search');
      expect(names).toContain('get_note');
      expect(names).not.toContain('append_note');
      expect(names).not.toContain('create_note');
    });
    it('tools/list not readOnly includes write tools', async () => {
      const result = await handleRpc({ method: 'tools/list', id: 3 }, fakeBackend, { readOnly: false, vaultName: '0.0.4' });
      const names = (result.result.tools || []).map((t) => t.name);
      expect(names).toContain('append_note');
      expect(names).toContain('create_note');
    });
    it('tools/call search returns path+snippet', async () => {
      const result = await handleRpc(
        { method: 'tools/call', id: 4, params: { name: 'search', arguments: { query: 'hello', limit: 5 } } },
        fakeBackend,
        { readOnly: true, vaultName: '0.0.4' },
      );
      const text = result.result.content[0].text;
      expect(text).toContain('hello');
      expect(text).toContain('snippet');
      expect(text).toContain('path');
    });
    it('write tool in readOnly returns isError', async () => {
      const result = await handleRpc(
        { method: 'tools/call', id: 5, params: { name: 'append_note', arguments: { path: 'a.md', text: 'x' } } },
        fakeBackend,
        { readOnly: true, vaultName: '0.0.4' },
      );
      // accept either JSON-RPC error or tool isError result
      const isErr = result.error || result.result?.isError;
      expect(isErr).toBeTruthy();
    });
    it('append_note succeeds when not readOnly', async () => {
      const result = await handleRpc(
        { method: 'tools/call', id: 5, params: { name: 'append_note', arguments: { path: 'a.md', text: 'x' } } },
        fakeBackend,
        { readOnly: false, vaultName: '0.0.4' },
      );
      expect(result.result).toBeDefined();
      expect(result.result.isError).not.toBe(true);
    });
    it('unknown method -32601', async () => {
      const result = await handleRpc({ method: 'nope', id: 6 }, fakeBackend, { readOnly: false, vaultName: '0.0.4' });
      expect(result.error.code).toBe(-32601);
    });
    it('newToken length', () => {
      expect(newToken().length).toBeGreaterThan(20);
    });
  });
});
