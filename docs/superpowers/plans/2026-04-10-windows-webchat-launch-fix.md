# Windows WebChat Launch Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Windows installer Web Chat button so it launches the authenticated OpenClaw Web Chat UI with the latest gateway token and logs enough evidence to diagnose future launch failures.

**Architecture:** Extract the launch-token selection and URL formatting into a small renderer helper so the stale-token bug can be tested without mounting React. Update `DoneStep` to always reconcile the latest config token before launch, then log a redacted launch summary and the `openExternal` result.

**Tech Stack:** Electron, React, TypeScript, Node built-in test runner

---

### Task 1: Add failing tests for launch token reconciliation and URL formatting

**Files:**
- Create: `tests/webchat-launch.test.ts`
- Create: `src/renderer/src/steps/webchat-launch.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildWebChatUrl,
  describeWebChatLaunch,
  resolveLaunchToken
} from '../src/renderer/src/steps/webchat-launch'

test('resolveLaunchToken prefers the latest config token over stale state', () => {
  assert.deepEqual(resolveLaunchToken({ stateToken: 'stale', configToken: 'fresh' }), {
    token: 'fresh',
    source: 'config'
  })
})

test('resolveLaunchToken keeps the current state token when config is unchanged', () => {
  assert.deepEqual(resolveLaunchToken({ stateToken: 'same', configToken: 'same' }), {
    token: 'same',
    source: 'state'
  })
})

test('describeWebChatLaunch redacts the token and reports hash mode', () => {
  assert.deepEqual(describeWebChatLaunch('http://127.0.0.1:18789/#token=secret'), {
    mode: 'hash',
    safeUrl: 'http://127.0.0.1:18789/#token=<redacted>'
  })
})

test('describeWebChatLaunch reports query mode when token is in the query string', () => {
  assert.deepEqual(describeWebChatLaunch('http://127.0.0.1:18789/?token=secret'), {
    mode: 'query',
    safeUrl: 'http://127.0.0.1:18789/?token=<redacted>'
  })
})

test('buildWebChatUrl uses hash token auth', () => {
  assert.equal(buildWebChatUrl('fresh token'), 'http://127.0.0.1:18789/#token=fresh%20token')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/webchat-launch.test.ts`
Expected: FAIL with module-not-found for `src/renderer/src/steps/webchat-launch`

- [ ] **Step 3: Write minimal implementation**

```ts
export function buildWebChatUrl(token: string): string {
  return `http://127.0.0.1:18789/#token=${encodeURIComponent(token)}`
}

export function resolveLaunchToken(params: {
  stateToken: string | null
  configToken?: string | null
}): { token: string | null; source: 'state' | 'config' | 'missing' } {
  const configToken = params.configToken ?? null
  if (configToken && configToken !== params.stateToken) {
    return { token: configToken, source: 'config' }
  }
  if (params.stateToken) {
    return { token: params.stateToken, source: 'state' }
  }
  if (configToken) {
    return { token: configToken, source: 'config' }
  }
  return { token: null, source: 'missing' }
}

export function describeWebChatLaunch(url: string): {
  mode: 'hash' | 'query' | 'missing'
  safeUrl: string
} {
  const parsed = new URL(url)
  const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash
  const hashParams = new URLSearchParams(hash)
  if (hashParams.has('token')) {
    hashParams.set('token', '<redacted>')
    parsed.hash = hashParams.toString()
    return { mode: 'hash', safeUrl: parsed.toString() }
  }
  if (parsed.searchParams.has('token')) {
    parsed.searchParams.set('token', '<redacted>')
    return { mode: 'query', safeUrl: parsed.toString() }
  }
  return { mode: 'missing', safeUrl: parsed.toString() }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/webchat-launch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/webchat-launch.test.ts src/renderer/src/steps/webchat-launch.ts
git commit -m "test: cover webchat launch token selection"
```

### Task 2: Update Done step to launch Web Chat with the latest token and emit diagnostics

**Files:**
- Modify: `src/renderer/src/steps/DoneStep.tsx`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/renderer/src/steps/webchat-launch.ts`

- [ ] **Step 1: Write the failing behavior expectation into the existing test file**

```ts
test('resolveLaunchToken returns missing when neither state nor config has a token', () => {
  assert.deepEqual(resolveLaunchToken({ stateToken: null, configToken: null }), {
    token: null,
    source: 'missing'
  })
})
```

- [ ] **Step 2: Run test to verify current behavior still matches the helper contract**

Run: `node --test --experimental-strip-types tests/webchat-launch.test.ts`
Expected: PASS

- [ ] **Step 3: Write minimal implementation in the renderer and IPC layer**

```ts
// src/renderer/src/steps/DoneStep.tsx
import { buildWebChatUrl, describeWebChatLaunch, resolveLaunchToken } from './webchat-launch'

const appendLog = (msg: string): void => {
  setLogs((prev) => [...prev, msg])
}

const configResult = await window.electronAPI.config.read()
const resolved = resolveLaunchToken({
  stateToken: gatewayToken,
  configToken: configResult.success ? configResult.config?.gatewayToken ?? null : null
})

if (resolved.source === 'config' && resolved.token) {
  setGatewayToken(resolved.token)
}

if (!resolved.token) {
  appendLog('webchat token source: missing')
  appendLog('webchat launch aborted: missing token')
  setShowLogs(true)
  return
}

const url = buildWebChatUrl(resolved.token)
const launchInfo = describeWebChatLaunch(url)
appendLog('webchat click received')
appendLog(`webchat installer version: ${installerVersion || 'unknown'}`)
appendLog(`webchat gateway status at launch: ${statusRef.current}`)
appendLog(`webchat token source: ${resolved.source}`)
appendLog(`webchat token length: ${resolved.token.length}`)
appendLog(`webchat url mode: ${launchInfo.mode}`)
appendLog(`webchat launch url: ${launchInfo.safeUrl}`)

const openResult = await window.electronAPI.system.openExternal(url)
appendLog(
  openResult.success
    ? 'webchat openExternal: success'
    : `webchat openExternal: failed: ${openResult.error || 'unknown error'}`
)
if (!openResult.success) setShowLogs(true)
```

```ts
// src/main/ipc-handlers.ts
ipcMain.handle('system:open-external', async (_e, url: string) => {
  try {
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const isTelegram = parsed.protocol === 'tg:'
    const isLocalWebChat =
      parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
      parsed.port === '18789'

    if (!(isHttps || isTelegram || isLocalWebChat)) {
      return { success: false, error: 'URL not allowed' }
    }

    const { shell } = await import('electron')
    await shell.openExternal(url)
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { success: false, error: msg }
  }
})
```

- [ ] **Step 4: Run tests and typecheck**

Run: `node --test --experimental-strip-types tests/webchat-launch.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/steps/DoneStep.tsx src/renderer/src/steps/webchat-launch.ts src/preload/index.ts src/preload/index.d.ts src/main/ipc-handlers.ts tests/webchat-launch.test.ts
git commit -m "fix: reconcile latest webchat token before launch"
```

### Task 3: Verify Windows-installer build safety

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add a reusable test script if needed**

```json
{
  "scripts": {
    "test:webchat-launch": "node --test --experimental-strip-types tests/webchat-launch.test.ts"
  }
}
```

- [ ] **Step 2: Run the focused test script**

Run: `npm run test:webchat-launch`
Expected: PASS

- [ ] **Step 3: Run the production build used for Windows packaging**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Record that the release build can now be cut from this repo**

```txt
Verification target for deployment: build a new Windows installer from this repo after the fix lands so version 1.3.137 is superseded by a patched release.
```

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: add webchat launch test script"
```
