# Changelog

## 0.0.9

Speed release. Measured on a generated 3,000-note sample vault (before -> after).

### Changed
- **Startup** — time to interactive 1.92 s -> 1.11 s (500 notes: 1.31 s -> 0.99 s; code view, 2k files: 1.46 s -> 1.05 s; 8k files: 3.05 s -> 1.62 s)
- **Index in its own process** — notes and code indexing run in an Electron utility process; the main process is no longer blocked while the full-text index builds (about 600 ms -> 40 ms)
- **Saved index cache** — the index is saved in app data and reused on the next launch; only changed notes are re-read (index start about 0.9 s -> 0.45 s on 3,000 notes)
- **One incremental index update per save** instead of several
- **Note open** — p95 279 ms -> 86 ms (note first, Sources panel right after; rendered-HTML cache; Markdown renderer warmed up while idle)
- **Ctrl+K** — results in about 20 ms (was about 73 ms); quick search p95 46 ms -> 23 ms
- **Graph** — hover and zoom off React, batched node painting, layout in a Web Worker, frame loop paused while hidden: 38/45 fps -> 60/60 fps (wheel/hover)
- **Board** — pan and zoom without React renders: pan 53 -> 60 fps, zoom 37 -> 49 fps
- **Smaller bundle** — renderer JS is minified (924 kB -> 520 kB); memory use about 15% lower

### Tests
- Unit tests for index startup, the index cache (edits, adds, deletes and renames while closed match a cold index; a corrupt cache is ignored) and the index process wiring

## 0.0.8

Speed release for big vaults (~2,500+ notes) and big folders. Plan: `PERF-PLAN.md`.

### Changed
- **Collapse by default for large note vaults** — over 800 notes, Graph shows folder groups plus hub notes (like code mode above 1,200 files). Double-click a folder dot to expand it; **Collapse** to fold back; **All notes (slow)** for the full graph
- **Faster graph settle** — force ticks, alpha decay and charge scale with node count; index refreshes reuse existing positions instead of re-running the layout
- **Cheaper drawing** — off-screen nodes, links and hit-areas are skipped; labels on large graphs wait until the layout settles (except hovered/selected/neighbors)
- **Less React work** — zoom % and hover no longer re-render the Graph pane on every event
- **IPC cache** — `getGraph` is cached per index version; board links (`fileLinks`) load after the graph and only while the Board is visible
- **Board** — `freeSlot` uses an occupancy grid (was O(n²)); auto-populate adds at most 150 note cards per folder with **Show more…**

### Fixed
- **"Could not save board" banner on first vault open** — two board saves at once shared one temp file name and the second rename failed (ENOENT). Saves to the same file now queue one after another and each uses a unique temp file; writes stay atomic (temp + rename)

### Tests
- Unit tests for collapsed note graph, force budget table, freeSlot (500 placements), and concurrent board saves

## 0.0.7

### Added
- **Code Architecture board** — IcePanel-style nested system / app / store / component groups inferred from the repo (Electron, monorepo workspaces, web, or generic folders)
- Board toggle **Architecture | Folders**; zoom-to-group; Reset layout; Regenerate; **Inferred** badge
- IPC `arch:get` / `arch:rebuild`; model + layout persist under app data (`code-arch/`, `code-boards/`) only — never writes into the repo
- Unit tests for `archinfer` + `arch-layout`

### Changed
- Code mode Board defaults to Architecture after open; Graph remains the file/folder import force view

### Privacy
- Local-only inference; architecture artifacts only in userData; no cloud; no secrets in captions

## 0.0.6

### Added
- Real local vector / meaning search via Ollama `nomic-embed-text` (768-d) on loopback only
- On-disk portable index at `<vault>/.nexus-vectors/` (manifest.json + chunks.jsonl snippets ≤500 chars + embeddings.f32)
- Incremental reindex via serial async queue on note changes; `semantic:rebuild` IPC
- CLI `npm run vectors:build -- --vault <path>` with `--dry-run` and chunkCount guard (>100k needs `--force`)
- Nomic `search_document:` / `search_query:` prefixes; SEM_MIN recalibrated to ~0.38
- Citations prefer stored chunk `startLine` from vector hits

### Changed
- Replaces in-memory FNV hashing-trick semantic index
- `embedBaseUrl` allowlisted to localhost / 127.0.0.1 / ::1 only
- Related notes uses mean of stored chunk vectors (never re-embeds whole note text)

### Privacy
- Embeddings only to local Ollama; `.nexus-vectors/` treated like vault content; not snapshotted (dot-dir skip)

## 0.0.5

### Added
- Local plain-text error log at `<userData>/logs/nexus-vault.log` (~1 MB, keeps `nexus-vault.1.log` and `nexus-vault.2.log`)
- Captures uncaught main/renderer errors, IPC handler failures, vault open/index/watch failures, board saves, ZIP import, MCP and settings errors, and renderer/GPU process crashes
- Error banners stay until dismissed; show a short code plus **Copy details** / **Open log**
- Help menu: **Open log folder**, **Copy last error** (Copy last error reads the log file tail)
- Main-process crashes: logged and a dialog offers **Open log folder**
- Startup vault-open failures logged as ERROR and shown as a banner
- Big-vault graph UX: initial camera lands on densest cluster (vaults ≥800 notes) instead of fit-all; Fit remains explicit
- Clickable graph legend to focus a folder (e.g. Projects vs Daily Notes); Fit frames the visible set
- Tighter label LOD and auto node size scaling for large graphs

### Privacy
- The log never leaves the machine; MCP bearer tokens, Authorization headers and secrets are redacted; home folder shown as `~` (Windows paths included); emails scrubbed
- MCP token re-registered for redaction after regenerate

## 0.0.4
- Back/Forward, semantic search, MCP AI access, memory packs, snapshots, citations (see README)
