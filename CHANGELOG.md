# Changelog

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
- Clickable graph legend to focus a folder (e.g. Kabbalah vs Qliphoth); Fit frames the visible set
- Tighter label LOD and auto node size scaling for large graphs

### Privacy
- The log never leaves the machine; MCP bearer tokens, Authorization headers and secrets are redacted; home folder shown as `~` (Windows paths included); emails scrubbed
- MCP token re-registered for redaction after regenerate

## 0.0.4
- Back/Forward, semantic search, MCP AI access, memory packs, snapshots, citations (see README)
