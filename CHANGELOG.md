# Changelog

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
