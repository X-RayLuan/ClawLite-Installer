# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClawLite is a **one-click Electron desktop installer** for the ClawLite AI agent. Built on electron-vite + React + Tailwind CSS 4, supporting macOS and Windows.

## Key Commands

```bash
npm run dev          # Development mode (electron-vite dev)
npm run build        # typecheck + electron-vite build
npm run lint         # eslint (cached)
npm run format       # prettier
npm run typecheck    # node + web type check

# Platform-specific builds
npm run build:mac       # macOS (publish always)
npm run build:win       # Windows (publish always)
npm run build:mac-local # macOS (local build only)
npm run build:win-local # Windows (local build only)
```

No test framework. Validate with `npm run typecheck` and `npm run lint`.

## Architecture

### 3-layer structure (Electron standard)

```
src/main/        → Main process (Node.js, system access)
src/preload/     → Preload (contextBridge exposes IPC API)
src/renderer/    → Renderer process (React UI)
```

- **tsconfig.node.json**: targets main + preload
- **tsconfig.web.json**: targets renderer, `@renderer/*` → `src/renderer/src/*` path alias

### Main process services (`src/main/services/`)

| File                | Role                                                          |
| ------------------- | ------------------------------------------------------------- |
| `wsl-utils.ts`      | WSL state detection, command execution/file read-write helpers in WSL |
| `env-checker.ts`    | Detects Node.js/ClawLite/WSL installation status and versions |
| `installer.ts`      | Auto-installs Node.js, WSL, ClawLite (platform-specific branching) |
| `onboarder.ts`      | Runs `openclaw onboard` CLI (API key setup, Telegram channel addition) |
| `gateway.ts`        | Gateway (local server) start/stop/status management           |
| `path-utils.ts`     | macOS PATH extension + binary search helpers                  |
| `tray-manager.ts`   | System tray icon + 10-second polling for Gateway status       |
| `updater.ts`        | Auto-update via `electron-updater` (check→download→install)   |
| `troubleshooter.ts` | Port occupancy check, `openclaw doctor --fix` execution, diagnostics |
| `uninstaller.ts`    | Uninstall (npm uninstall -g + config directory cleanup)       |
| `backup.ts`         | Settings backup/restore (tar-based, WSL support)              |

### IPC Communication Pattern

1. `ipc-handlers.ts` registers `ipcMain.handle()` handlers
2. `preload/index.ts` exposes to renderer via `contextBridge.exposeInMainWorld('electronAPI', ...)`
3. Renderer calls `window.electronAPI.xxx()`
4. Install progress sent via `install:progress` / `install:error` events (main→renderer, one-way)

When adding IPC channels: update `ipc-handlers.ts` handler → `preload/index.ts` electronAPI object → `preload/index.d.ts` type declaration (all three files).

### App Lifecycle

- Window close ≠ app quit: `close` event is intercepted, window is hidden, app stays in tray
- Actual quit: tray menu "Quit" → `isQuitting = true` → `app.quit()`
- Auto-start: `app.setLoginItemSettings({ openAtLogin, openAsHidden: true })`. On auto-start, skips window display and only auto-starts Gateway
- Auto-update: checks for updates 5 seconds after app start. `update:available` → user click → `update:progress` → `update:downloaded` → restart. `autoInstallOnAppQuit: true`

### Renderer Wizard Flow

`useWizard` hook manages step navigation. Order:

`welcome` → `envCheck` → (`wslSetup`) → (`install`) → `apiKeyGuide` → `telegramGuide` → `config` → `done`

- `troubleshoot` step is not in the STEPS array; entered via `goTo()` from `DoneStep`
- `wslSetup` step only entered on Windows when WSL is not ready
- `install` step conditionally entered based on environment check results
- `goTo()` enables step skipping, `history` ref supports back navigation
- Each Step component is in `src/renderer/src/steps/`, transitions via `onNext`/`onDone` callbacks
- Supported providers: `anthropic | google | openai | minimax | glm`

### Windows Support (WSL Mode)

On Windows, Node.js and the agent run inside WSL (Windows Subsystem for Linux) Ubuntu.

- **`wsl-utils.ts`**: Foundation for all WSL commands. Uses `wsl -d Ubuntu -u root` pattern to skip user setup prompts
  - `checkWslState()`: Determines WSL state (`not_available` → `not_installed` → `needs_reboot` → `no_distro` → `not_initialized` → `ready`)
  - `runInWsl(script)`: Runs commands in WSL via `bash -lc` including nvm PATH
  - `readWslFile(path)` / `writeWslFile(path, content)`: Read/write files inside WSL
- **WSL install flow**: `installWsl()` → reboot → `installNodeWsl()` (nvm + LTS) → `installClawLiteWsl()` (npm -g)
- **Reboot recovery**: State saved to `wizard-state.json` (`app.getPath('userData')`), 24-hour expiry, deleted on reaching done
- **IPC channels**: `wsl:check`, `wsl:install`, `wizard:save-state`, `wizard:load-state`, `wizard:clear-state`
- WSL config path: `/root/.openclaw/openclaw.json`

### Release Distribution

Source code and binaries are managed in the `ClawLite/ClawLite-Installer` single repository.

**Release process** (`npm run release` = `scripts/release.mjs`):

1. `npm run release` (or `npm run release -- minor/major`)
2. Script bumps version → commit & push → creates GitHub release
3. GitHub Actions automatically: build macOS/Windows → upload binaries to same release

**Workflow structure**:

- `build-mac` (macos-latest): `build:mac-local` → `gh release upload`
- `build-win` (windows-latest): `build:win-local` → `gh release upload`

**Secrets** (GitHub Actions Secrets):

- macOS code signing: `CSC_LINK`, `CSC_KEY_PASSWORD`
- macOS notarization: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`

**Download URLs** (version-independent, always latest):

- macOS: `https://github.com/ClawLite/ClawLite-Installer/releases/latest/download/clawlite.dmg`
- Windows: `https://github.com/ClawLite/ClawLite-Installer/releases/latest/download/clawlite-setup.exe`

**Build filenames**: Fixed without version in `electron-builder.yml` (`clawlite.dmg`, `clawlite-setup.exe`)

### Vercel Deployment (docs/ + api/)

- `docs/`: Static marketing page (clawlite.ai)
- `api/newsletter.js`: Newsletter subscription serverless function
- `api/waitlist.js`: Waitlist serverless function (Vercel Blob storage)
- Configured via `vercel.json`, independent from the Electron app

## Code Style

- Prettier: single quotes, no semicolons, 100 char width, trailing comma none
- ESLint: `@electron-toolkit/eslint-config-ts` + `eslint-config-prettier` + React hooks/refresh rules
- Indentation: 2 spaces, LF line endings
- **Code comments**: Write in English (for international contributors)
- **Commit messages**: English Conventional Commits (e.g. `feat:`, `fix:`, `refactor:`)

## UI Theme

Dark mode based. Custom colors defined in `src/renderer/src/assets/main.css` `@theme` block:

- primary: `#f97316` (orange), bg: `#080c18` (dark)
- Use in Tailwind as `text-primary`, `bg-bg-card`, `text-text-muted`, etc.
- Background: Aurora gradient + SVG noise grain + bubble animation

## Hardcoded Values

Check all related files when changing:

| Item                    | Value     | Key locations                                               |
| ----------------------- | --------- | ----------------------------------------------------------- |
| Node.js minimum version | `22.16.0` | `env-checker.ts`                                            |
| Gateway port            | `18789`   | `troubleshooter.ts`, `onboarder.ts`, `TroubleshootStep.tsx` |
| Reboot recovery expiry  | 24 hours  | `ipc-handlers.ts`                                           |
| Tray polling interval   | 10 sec    | `tray-manager.ts`                                           |
| Update check delay      | 5 sec     | `index.ts`                                                  |
| Agent update check      | 30 min    | `DoneStep.tsx`                                              |

## Important Notes

- `onboarder.ts` is a large function containing complex logic including IPv6 fix, plist patching, Telegram 409 resolution. When modifying, verify both macOS and Windows (WSL) code paths
- macOS: Uses `getPathEnv()` / `findBin()` (`path-utils.ts`) pattern to extend NVM/Volta/npm-global PATH
- Windows: All WSL commands run through `wsl-utils.ts` helpers. For shell injection prevention, arguments must use single-quote escaping (`'${arg.replace(/'/g, "'\\''")}'` pattern)
- `WslState` type is declared separately in `wsl-utils.ts`, `preload/index.d.ts`, and renderer components (`App.tsx`). Sync all when changing state values
- IPv6 priority prevention in WSL: `NODE_OPTIONS=--dns-result-order=ipv4first` set when running Gateway
