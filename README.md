# Nexus Vault

A local-first Windows desktop app for knowledge management, built with Electron, TypeScript, and React.

## What M0 Does

- **Vault picker**: Open a safe copy of a vault (recommended) or open a folder as a vault directly
- **Recent vaults**: List with "copy" badge, last opened time, and "not found" indication
- **Folder tree**: Lazy-loaded, keyboard-navigable, folder-note awareness, collapsible
- **Themes**: Light / Dark / System with live switching and persistence
- **Layout shell**: Resizable panels (tree, tool strip, graph/board panes), persisted layout
- **View modes**: Graph only / Side-by-side (Board left, Graph right) / Board only
- **Tool strip**: 9 disabled placeholder tools with tooltips (coming in M2)
- **Status bar**: Local-only indicator, read-only (M0), note count, app version
- **Security**: Context isolation, sandbox, CSP, blocked navigation, no network calls
- **Read-only guarantee**: Never writes to vault folders in M0

## Privacy Statement

Nexus Vault is **local-first** and **offline by design**:

- No network requests of any kind
- No telemetry, analytics, or crash reporting
- No auto-update checks
- No accounts or cloud sync
- All data stays in your chosen vault folder on your computer
- The only writes are: app settings in `userData` and safe-copy creation in Documents

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Type checking
npm run typecheck

# Run unit tests
npm test

# Build for production
npm run build

# Build Windows installer (NSIS + portable)
npm run dist:win

# Build Linux directory
npm run dist:linux
```

## Building Windows Installer

Run on Windows or cross-compile from Linux:

```bash
npm run dist:win
```

Outputs to `dist/`:
- `Nexus-Vault-Setup-0.0.1.exe` (NSIS installer)
- `Nexus-Vault-Portable-0.0.1.exe` (portable)

Cross-build from Linux works because:
- No native Node modules in M0
- `signAndEditExecutable: false` in electron-builder config
- electron-builder downloads Windows Electron binaries automatically

## Environment Variables (for testing/screenshots)

- `NEXUS_VAULT_OPEN=<path>` — Open that folder as the active vault on launch
- `NEXUS_THEME=light|dark` — Force theme for session (no save)
- `NEXUS_USER_DATA=<dir>` — Override userData path (call before app ready)
- `NEXUS_SCREENSHOT=<file.png>` — Capture page to file after load, then quit
- `NEXUS_EXPAND=<comma,separated,relPaths>` — Pre-expand folders in tree

## License

Apache-2.0 — Copyright 2026 Jesse Lugo

See [LICENSE](LICENSE) for full text.