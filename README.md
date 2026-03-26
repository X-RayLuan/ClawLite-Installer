# ClawLite

**One-click AI agent installer for macOS and Windows.**

ClawLite is the desktop app that helps users set up their AI agent with fewer manual steps and less terminal friction.

**Download:** <https://github.com/ClawLite/ClawLite-Installer/releases/latest>

**Website:** <https://clawlite.ai>

---

# Why people use it

- Faster AI agent setup
- Lower friction for beginners
- Cross-platform installer flow
- Easier onboarding for BYOK / token setup
- Cleaner path from download to first run

---

# What it does

The installer is designed around a simple flow:

**Download → Run → Configure → Launch**

Current repo scope includes:

- desktop installer app
- macOS and Windows packaging
- release scripts
- content / launch assets
- signing and release workflow support

---

# Supported platforms

- macOS
- Windows

---

# Development

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Package locally:

```bash
npm run build:mac-local
npm run build:win-local
```

---

# Release notes

macOS notarized release:

```bash
export APPLE_API_KEY=/path/to/AuthKey_XXXXXX.p8
export APPLE_API_KEY_ID=XXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
npm run build:mac
```

Windows signed release:

```bash
export CSC_LINK=/path/to/windows-codesign.p12
export CSC_KEY_PASSWORD=your_cert_password
npm run build:win
```

---

# Repo highlights

- `resources/` app icons and packaged assets
- `build/` platform packaging config
- `scripts/release.mjs` release workflow
- `docs/` web assets / docs collateral
- `marketing/` launch copy and campaign material

---

# Bottom line

ClawLite is the easier path into AI agents, and this repo is the installer that makes that promise real.
