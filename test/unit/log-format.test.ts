import { describe, expect, it } from 'vitest';
import { clip, errInfo, formatLine, redact, shortCode } from '../../src/shared/log-format';

describe('log-format', () => {
  it('formatLine pads level/source and indents stack', () => {
    const line = formatLine({
      ts: '2026-10-05T20:31:04.123Z',
      level: 'ERROR',
      source: 'main',
      tag: 'ipc',
      message: 'vault:open failed',
      stack: 'Error: nope\n    at openVault (index.js:1:1)',
    });
    expect(line).toContain('2026-10-05T20:31:04.123Z ERROR main     ipc vault:open failed\n');
    expect(line).toMatch(/^    Error: nope$/m);
    expect(line).toMatch(/^    at openVault/m);
  });

  it('collapses multi-line messages', () => {
    const line = formatLine({
      ts: 't',
      level: 'INFO',
      source: 'renderer',
      tag: 'x',
      message: 'first\nsecond',
    });
    expect(line.split('\n')[0]).toContain('first');
    expect(line).toMatch(/^    second$/m);
  });

  it('redacts token, bearer, home, email', () => {
    const tok = 'sekretTok12345678';
    expect(redact(`token is ${tok}`, { token: tok })).toContain('[redacted]');
    expect(redact('Authorization: Bearer abcdefghijklmnop')).toContain('[redacted]');
    expect(redact('Authorization: Bearer abcdefghijklmnop')).not.toMatch(/abcdefghijklmnop/);
    expect(redact('hi Bearer abcdefghijklmnop bye')).toMatch(/Bearer \[redacted\]/i);
    expect(redact('"token":"abc12345xyz"')).toContain('[redacted]');
    expect(redact('C:\\Users\\jesse\\Notes\\a.md', { home: 'C:\\Users\\jesse' })).toMatch(/^~[/\\]Notes/);
    expect(redact('/home/jesse/Notes', { home: '/home/jesse' })).toBe('~/Notes');
    expect(redact('mail me@example.com please')).toContain('[email]');
    expect(redact('hello world')).toBe('hello world');
  });

  it('clip truncates with suffix', () => {
    expect(clip('abcdef', 3)).toBe('abc… (3 more chars)');
    expect(clip('ab', 3)).toBe('ab');
  });

  it('shortCode stable and 4 chars', () => {
    expect(shortCode('same')).toBe(shortCode('same'));
    expect(shortCode('a')).not.toBe(shortCode('b'));
    expect(shortCode('x')).toMatch(/^[0-9a-z]{4}$/);
  });

  it('errInfo handles shapes', () => {
    expect(errInfo(new Error('boom')).message).toBe('boom');
    expect(errInfo({ message: 'm' }).message).toBe('m');
    expect(errInfo('s').message).toBe('s');
    expect(errInfo(42).message).toBe('42');
  });
});
