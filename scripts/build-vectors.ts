#!/usr/bin/env npx tsx
/**
 * Headless vector index builder for a notes vault (box → PC ship workflow).
 * Usage:
 *   npm run vectors:build -- --vault /path/to/vault
 *   npm run vectors:build -- --vault /path --dry-run
 *   npm run vectors:build -- --vault /path --force
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chunkNote, CHUNK_MAX_CHARS, MAX_CHUNKS_PER_NOTE, SNIPPET_MAX_CHARS } from '../src/main/semantic-chunk';
import { resolveIndexDir, INDEX_FORMAT_VERSION } from '../src/main/vector-store';
import {
  DEFAULT_EMBED_MODEL,
  DOC_PREFIX,
  EMBED_PREFIX_VERSION,
  NOMIC_DIMS,
  QUERY_PREFIX,
  embedTexts,
  ollamaReachable,
} from '../src/main/ollama-embed';

function parseArgs(argv: string[]) {
  let vault = '';
  let dryRun = false;
  let force = false;
  let model = DEFAULT_EMBED_MODEL;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vault') vault = argv[++i] ?? '';
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--force') force = true;
    else if (a === '--model') model = argv[++i] ?? model;
  }
  return { vault, dryRun, force, model };
}

function* walkMd(root: string): Generator<{ rel: string; abs: string }> {
  const stack = [''];
  while (stack.length) {
    const relDir = stack.pop()!;
    const absDir = path.join(root, relDir);
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push(rel);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        yield { rel: rel.replace(/\\/g, '/'), abs: path.join(root, rel) };
      }
    }
  }
}

function titleOf(rel: string, content: string): string {
  const m = /^#\s+(.+)$/m.exec(content);
  if (m) return m[1].trim();
  return path.basename(rel, '.md');
}

function sha1(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function atomicWrite(file: string, data: string | Buffer): void {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

async function main() {
  const { vault, dryRun, force, model } = parseArgs(process.argv.slice(2));
  if (!vault || !fs.existsSync(vault)) {
    console.error('Usage: vectors:build -- --vault <path> [--dry-run] [--force] [--model nomic-embed-text]');
    process.exit(2);
  }

  type Job = { rel: string; title: string; hash: string; chunks: { text: string; snippet: string; startLine: number }[] };
  const jobs: Job[] = [];
  let est = 0;
  for (const { rel, abs } of walkMd(vault)) {
    const content = fs.readFileSync(abs, 'utf8');
    const title = titleOf(rel, content);
    const parts = chunkNote(content, { maxChars: CHUNK_MAX_CHARS, maxChunks: MAX_CHUNKS_PER_NOTE });
    if (parts.length === 0) parts.push({ text: title, snippet: title.slice(0, SNIPPET_MAX_CHARS), startLine: 1 });
    est += parts.length;
    jobs.push({
      rel,
      title,
      hash: sha1(title + '\n' + content),
      chunks: parts.map((p) => ({ text: p.text, snippet: p.snippet.slice(0, SNIPPET_MAX_CHARS), startLine: p.startLine })),
    });
  }
  console.log(`notes=${jobs.length}`);
  console.log(`estimatedChunks=${est} (target band 40k–80k; abort >100k without --force)`);
  if (dryRun) {
    process.exit(0);
  }
  if (est > 100_000 && !force) {
    console.error(`chunkCount estimate ${est} > 100000 — re-run with --force to proceed`);
    process.exit(3);
  }
  const ok = await ollamaReachable();
  if (!ok) {
    console.error('Ollama not reachable at 127.0.0.1:11434');
    process.exit(4);
  }
  const indexPath = resolveIndexDir(vault);
  console.log(`indexPath=${indexPath} model=${model}`);
  fs.mkdirSync(indexPath, { recursive: true });

  // Flatten all embed texts
  const flat: { job: number; ci: number; embedText: string }[] = [];
  for (let j = 0; j < jobs.length; j++) {
    const job = jobs[j];
    for (let ci = 0; ci < job.chunks.length; ci++) {
      flat.push({ job: j, ci, embedText: job.title + '\n' + job.chunks[ci].text });
    }
  }

  const dims = NOMIC_DIMS;
  const embeddings = new Float32Array(flat.length * dims);
  const t0 = Date.now();
  const BATCH = 16;
  // Resumable checkpoints: every ~SHARD_SIZE chunks, append a shard (vectors + keys) to a work dir
  // outside the index dir. Key = sha1(model + embedText), so edits/reorders never reuse stale vectors.
  const SHARD_SIZE = Number(process.env.VEC_SHARD_SIZE || 512);
  const workDir = path.join(vault, '.nexus-vectors-build');
  fs.mkdirSync(workDir, { recursive: true });
  const keyOf = (t: string) => sha1(model + '\n' + t);
  const cache = new Map<string, Float32Array>();
  for (const f of fs.readdirSync(workDir).filter((n) => /^shard-\d+\.keys\.json$/.test(n)).sort()) {
    try {
      const keys = JSON.parse(fs.readFileSync(path.join(workDir, f), 'utf8')) as string[];
      const buf = fs.readFileSync(path.join(workDir, f.replace('.keys.json', '.f32')));
      if (buf.byteLength !== keys.length * dims * 4) continue; // torn shard: ignore, redo
      const arr = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      keys.forEach((k, i) => cache.set(k, arr.subarray(i * dims, (i + 1) * dims)));
    } catch { /* corrupt shard: ignore */ }
  }
  let shardNo = fs.readdirSync(workDir).filter((n) => /^shard-\d+\.keys\.json$/.test(n)).length;
  const todo: number[] = [];
  for (let i = 0; i < flat.length; i++) {
    const v = cache.get(keyOf(flat[i].embedText));
    if (v) embeddings.set(v, i * dims);
    else todo.push(i);
  }
  const resumed = flat.length - todo.length;
  console.log(`resume: ${resumed}/${flat.length} chunks already embedded; ${todo.length} to go (shard=${SHARD_SIZE})`);
  const writeProgress = (done: number, rate: number) =>
    atomicWrite(path.join(workDir, 'progress.json'), JSON.stringify({ total: flat.length, done, rate, updatedAt: new Date().toISOString(), pid: process.pid }));
  let pendKeys: string[] = [];
  let pendVecs: Float32Array[] = [];
  const flush = () => {
    if (!pendKeys.length) return;
    const name = `shard-${String(shardNo++).padStart(5, '0')}`;
    const out = new Float32Array(pendVecs.length * dims);
    pendVecs.forEach((v, i) => out.set(v, i * dims));
    atomicWrite(path.join(workDir, name + '.f32'), Buffer.from(out.buffer));
    atomicWrite(path.join(workDir, name + '.keys.json'), JSON.stringify(pendKeys)); // keys last = commit marker
    pendKeys = [];
    pendVecs = [];
  };
  let doneNew = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const idxs = todo.slice(i, i + BATCH);
    const vecs = await embedTexts(idxs.map((j) => flat[j].embedText), { model });
    for (let k = 0; k < vecs.length; k++) {
      embeddings.set(vecs[k], idxs[k] * dims);
      pendKeys.push(keyOf(flat[idxs[k]].embedText));
      pendVecs.push(Float32Array.from(vecs[k]));
    }
    doneNew += idxs.length;
    const elapsed = (Date.now() - t0) / 1000;
    const rate = doneNew / Math.max(1, elapsed);
    if (pendKeys.length >= SHARD_SIZE) {
      flush();
      writeProgress(resumed + doneNew, rate);
    }
    if (doneNew === todo.length || doneNew % 64 === 0 || doneNew <= BATCH) {
      const done = resumed + doneNew;
      const pct = ((done / flat.length) * 100).toFixed(1);
      const eta = ((todo.length - doneNew) / Math.max(0.01, rate) / 60).toFixed(1);
      console.log(`  embedding chunks ${done}/${flat.length} (${pct}%) ~${rate.toFixed(1)}/s eta ${eta}m`);
    }
  }
  flush();
  writeProgress(flat.length, 0);
  console.log('');

  // Write chunks.jsonl + notes.json + embeddings.f32 + manifest
  const chunkLines: string[] = [];
  const notes: Record<string, { contentHash: string; chunkIds: number[] }> = {};
  let id = 0;
  for (let j = 0; j < jobs.length; j++) {
    const job = jobs[j];
    const ids: number[] = [];
    for (let ci = 0; ci < job.chunks.length; ci++) {
      const c = job.chunks[ci];
      chunkLines.push(
        JSON.stringify({
          id,
          rel: job.rel,
          title: job.title,
          text: c.snippet.slice(0, SNIPPET_MAX_CHARS),
          startLine: c.startLine,
          hash: sha1(c.text),
        }),
      );
      ids.push(id);
      id++;
    }
    notes[job.rel] = { contentHash: job.hash, chunkIds: ids };
  }
  atomicWrite(path.join(indexPath, 'chunks.jsonl'), chunkLines.join('\n') + '\n');
  atomicWrite(path.join(indexPath, 'embeddings.f32'), Buffer.from(embeddings.buffer, embeddings.byteOffset, embeddings.byteLength));
  atomicWrite(path.join(indexPath, 'notes.json'), JSON.stringify(notes));
  const now = new Date().toISOString();
  const manifest = {
    indexFormatVersion: INDEX_FORMAT_VERSION,
    model,
    dims,
    metric: 'cosine',
    chunkMaxChars: CHUNK_MAX_CHARS,
    chunkOverlap: 300,
    embedPrefixVersion: EMBED_PREFIX_VERSION,
    docPrefix: DOC_PREFIX,
    queryPrefix: QUERY_PREFIX,
    createdAt: now,
    updatedAt: now,
    chunkCount: flat.length,
    noteCount: jobs.length,
  };
  atomicWrite(path.join(indexPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(workDir, 'DONE'), new Date().toISOString());
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(JSON.stringify({ indexed: jobs.length, chunks: flat.length, model, indexPath }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
