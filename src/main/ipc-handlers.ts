import { ipcMain, BrowserWindow, app, net } from 'electron'

// ─── Helper: HTTP GET using Electron's net (respects system proxy) ───
async function httpGet(url: string, timeoutMs = 15000): Promise<{ body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET' })
    const timeout = setTimeout(() => { req.abort(); reject(new Error('timeout')) }, timeoutMs)
    let data = ''
    req.on('response', (resp) => {
      clearTimeout(timeout)
      resp.on('data', (chunk) => { data += chunk.toString() })
      resp.on('end', () => resolve({ body: data, status: resp.statusCode }))
      resp.on('error', reject)
    })
    req.on('error', (e) => { clearTimeout(timeout); reject(e) })
    req.end()
  })
}
import { spawn, spawnSync } from 'child_process'
import { platform } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { randomBytes } from 'crypto'
import { getPathEnv, findBin } from './services/path-utils'

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')

// ─── Installer-specific config (channel preferences) ───────────────────────
interface InstallerChannelConfig {
  enabled?: 'telegram' | 'lark'
  telegram?: { botToken?: string }
  lark?: { enabled?: boolean }
}

interface InstallerConfig {
  channels?: InstallerChannelConfig
}

interface FeishuRegistrationBegin {
  deviceCode: string
  qrUrl: string
  userCode?: string
  interval: number
  expireIn: number
  /** Original tp/from from the Lark/Feishu server, used in poll requests */
  tp?: string
  from?: string
}

interface FeishuRegistrationResult {
  appId: string
  appSecret: string
  domain: 'feishu' | 'lark'
  openId?: string
}

interface FeishuRegistrationOutcome {
  status: 'success' | 'access_denied' | 'expired' | 'timeout' | 'error'
  result?: FeishuRegistrationResult
  message?: string
}

const FEISHU_ACCOUNTS_URL = 'https://accounts.feishu.cn'
const LARK_ACCOUNTS_URL = 'https://accounts.larksuite.com'
const FEISHU_REGISTRATION_PATH = '/oauth/v1/app/registration'
const FEISHU_REGISTRATION_TIMEOUT_MS = 90000
const DEFAULT_FEISHU_POLL_INTERVAL_SECONDS = 5
const DEFAULT_FEISHU_REGISTRATION_EXPIRE_SECONDS = 600

const getInstallerConfigPath = (): string =>
  join(homedir(), '.config', 'clawlite-installer', 'config.json')

const readInstallerConfig = (): InstallerConfig => {
  try {
    const p = getInstallerConfigPath()
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    /* ignore */
  }
  return {}
}

const writeInstallerConfig = (cfg: InstallerConfig): void => {
  const p = getInstallerConfigPath()
  const dir = join(homedir(), '.config', 'clawlite-installer')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(p, JSON.stringify(cfg, null, 2), { mode: 0o600 })
}

const feishuAccountsBaseUrl = (domain: 'feishu' | 'lark'): string =>
  domain === 'lark' ? LARK_ACCOUNTS_URL : FEISHU_ACCOUNTS_URL

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const postFeishuRegistration = async (
  domain: 'feishu' | 'lark',
  body: Record<string, string>
): Promise<Record<string, any>> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FEISHU_REGISTRATION_TIMEOUT_MS)
  try {
    const res = await fetch(`${feishuAccountsBaseUrl(domain)}${FEISHU_REGISTRATION_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: controller.signal
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json?.error_description || json?.error || `HTTP ${res.status}`)
    return json
  } finally {
    clearTimeout(timer)
  }
}

const initFeishuRegistration = async (domain: 'feishu' | 'lark' = 'feishu'): Promise<void> => {
  const res = await postFeishuRegistration(domain, { action: 'init' })
  const methods = Array.isArray(res.supported_auth_methods) ? res.supported_auth_methods : []
  if (!methods.includes('client_secret')) {
    throw new Error('Feishu scan-to-create is not available in this environment')
  }
}

const beginFeishuRegistration = async (
  domain: 'feishu' | 'lark' = 'feishu'
): Promise<FeishuRegistrationBegin> => {
  await initFeishuRegistration(domain)
  const res = await postFeishuRegistration(domain, {
    action: 'begin',
    archetype: 'PersonalAgent',
    auth_method: 'client_secret',
    request_user_info: 'open_id'
  })

  if (!res.device_code || !res.verification_uri_complete) {
    throw new Error('Feishu registration did not return a QR URL')
  }

  const qrUrl = new URL(String(res.verification_uri_complete))
  // Preserve original tp from server; only add from if not already set
  const originalTp = qrUrl.searchParams.get('tp')
  if (!qrUrl.searchParams.has('from')) {
    qrUrl.searchParams.set('from', 'clawlite_installer')
  }

  return {
    deviceCode: String(res.device_code),
    qrUrl: qrUrl.toString(),
    userCode: res.user_code ? String(res.user_code) : undefined,
    interval: Number(res.interval || DEFAULT_FEISHU_POLL_INTERVAL_SECONDS),
    expireIn: Number(res.expire_in || DEFAULT_FEISHU_REGISTRATION_EXPIRE_SECONDS),
    tp: originalTp ?? undefined,
    from: qrUrl.searchParams.get('from') ?? undefined
  }
}

const pollFeishuRegistration = async (params: {
  deviceCode: string
  interval?: number
  expireIn?: number
  initialDomain?: 'feishu' | 'lark'
  tp?: string
  from?: string
}): Promise<FeishuRegistrationOutcome> => {
  let currentInterval = params.interval || DEFAULT_FEISHU_POLL_INTERVAL_SECONDS
  let domain: 'feishu' | 'lark' = params.initialDomain || 'feishu'
  let domainSwitched = false
  const deadline = Date.now() + (params.expireIn || DEFAULT_FEISHU_REGISTRATION_EXPIRE_SECONDS) * 1000

  while (Date.now() < deadline) {
    let pollRes: Record<string, any>
    try {
      pollRes = await postFeishuRegistration(domain, {
        action: 'poll',
        device_code: params.deviceCode,
        tp: 'ob_app'
      })
    } catch {
      await sleep(currentInterval * 1000)
      continue
    }

    // Check for success FIRST — the current response may already contain client_id
    if (pollRes.client_id && pollRes.client_secret) {
      return {
        status: 'success',
        result: {
          appId: String(pollRes.client_id),
          appSecret: String(pollRes.client_secret),
          domain,
          openId: pollRes.user_info?.open_id ? String(pollRes.user_info.open_id) : undefined
        }
      }
    }

    // Then handle domain switch — do NOT continue without checking this response
    const tenantBrand = pollRes.user_info?.tenant_brand
    if (!domainSwitched && tenantBrand === 'lark') {
      domain = 'lark'
      domainSwitched = true
      // Re-poll immediately with the correct domain (do not skip this response)
      continue
    }

    const error = pollRes.error ? String(pollRes.error) : ''
    if (error === 'slow_down') currentInterval += 5
    else if (error === 'access_denied') return { status: 'access_denied' }
    else if (error === 'expired_token') return { status: 'expired' }
    else if (error && error !== 'authorization_pending') {
      return {
        status: 'error',
        message: `${error}: ${pollRes.error_description || 'unknown'}`
      }
    }

    await sleep(currentInterval * 1000)
  }

  return { status: 'timeout' }
}

const applyFeishuOpenClawConfig = async (result: FeishuRegistrationResult): Promise<void> => {
  // Complete base config for Feishu channel + gateway settings
  const patch = {
    gateway: {
      mode: 'local',
      bind: 'loopback',
      auth: {
        mode: 'token'
      }
    },
    commands: {
      restart: true
    },
    plugins: {
      allow: ['feishu']
    },
    channels: {
      feishu: {
        enabled: true,
        appId: result.appId,
        appSecret: result.appSecret,
        connectionMode: 'websocket',
        domain: result.domain,
        dmPolicy: 'allowlist',
        allowFrom: result.openId ? [result.openId] : [],
        groupPolicy: 'allowlist'
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(findBin('openclaw'), ['config', 'patch', '--stdin'], {
      env: getPathEnv(),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `openclaw config patch exited with ${code}`))
    })
    child.stdin.write(JSON.stringify(patch))
    child.stdin.end()
  })
}
import i18nMain, { initI18nMain } from '../shared/i18n/main'
import { rebuildTrayMenu } from './services/tray-manager'
import { checkEnvironment, checkOpenclawUpdate } from './services/env-checker'
import { checkPort, runDoctorFix } from './services/troubleshooter'
import {
  installNodeMac,
  installOpenClaw,
  installWsl,
  installNodeWsl,
  installOpenClawWsl
} from './services/installer'
import { runOnboard, readCurrentConfig, switchProvider } from './services/onboarder'
import {
  startGateway,
  stopGateway,
  restartGateway,
  getGatewayStatus,
  setGatewayLogCallback
} from './services/gateway'
import { checkWslState } from './services/wsl-utils'
import { checkForUpdates, downloadUpdate, installUpdate } from './services/updater'
import { uninstallOpenClaw } from './services/uninstaller'
import { exportBackup, importBackup } from './services/backup'
import { loginOpenAICodex } from './services/oauth'

interface WizardPersistedState {
  step: string
  wslInstalled: boolean
  timestamp: number
}

const getWizardStatePath = (): string => join(app.getPath('userData'), 'wizard-state.json')
const getSettingsPath = (): string => join(app.getPath('userData'), 'settings.json')

let handlersRegistered = false

const readSettings = (): Record<string, unknown> => {
  try {
    const p = getSettingsPath()
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    /* ignore */
  }
  return {}
}

const writeSettings = (patch: Record<string, unknown>): void => {
  const settings = { ...readSettings(), ...patch }
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2))
}

export const getSavedLocale = (): string => {
  const settings = readSettings()
  if (typeof settings.language === 'string') return settings.language
  const sys = app.getLocale()
  if (sys.startsWith('ko')) return 'ko'
  if (sys.startsWith('ja')) return 'ja'
  if (sys.startsWith('zh')) return 'zh'
  return 'en'
}

export const registerIpcHandlers = (getWin: () => BrowserWindow | null): void => {
  if (handlersRegistered) return
  handlersRegistered = true

  const win = (): BrowserWindow => {
    const w = getWin()
    if (!w || w.isDestroyed()) throw new Error('No active window')
    return w
  }

  ipcMain.handle('env:check', () => checkEnvironment())
  ipcMain.handle('openclaw:check-update', () => checkOpenclawUpdate())

  // WSL-related IPC
  ipcMain.handle('wsl:check', () => checkWslState())

  ipcMain.handle('wsl:install', async () => {
    try {
      const result = await installWsl(win())
      return { success: true, needsReboot: result.needsReboot }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      try {
        win().webContents.send('install:error', msg)
      } catch {
        /* window destroyed */
      }
      return { success: false, error: msg }
    }
  })

  // Wizard state persistence IPC
  ipcMain.handle('wizard:save-state', (_e, state: WizardPersistedState) => {
    try {
      writeFileSync(getWizardStatePath(), JSON.stringify(state))
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  ipcMain.handle('wizard:load-state', () => {
    try {
      const path = getWizardStatePath()
      if (!existsSync(path)) return null
      const state: WizardPersistedState = JSON.parse(readFileSync(path, 'utf-8'))
      // Expire after 24 hours
      if (Date.now() - state.timestamp > 24 * 60 * 60 * 1000) {
        unlinkSync(path)
        return null
      }
      return state
    } catch {
      return null
    }
  })

  ipcMain.handle('wizard:clear-state', () => {
    try {
      const path = getWizardStatePath()
      if (existsSync(path)) unlinkSync(path)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  ipcMain.handle('install:node', async () => {
    try {
      if (platform() === 'win32') {
        await installNodeWsl(win())
      } else {
        await installNodeMac(win())
      }
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      try {
        win().webContents.send('install:error', msg)
      } catch {
        /* window destroyed */
      }
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('install:openclaw', async () => {
    try {
      if (platform() === 'win32') {
        await installOpenClawWsl(win())
      } else {
        await installOpenClaw(win())
      }
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      try {
        win().webContents.send('install:error', msg)
      } catch {
        /* window destroyed */
      }
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(
    'onboard:run',
    async (
      _e,
      config: {
        provider: 'anthropic' | 'google' | 'openai' | 'minimax' | 'glm'
        apiKey?: string
        authMethod?: 'api-key' | 'oauth'
        telegramBotToken?: string
        modelId?: string
      }
    ) => {
      try {
        const result = await runOnboard(win(), config)
        return { success: true, botUsername: result.botUsername }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        try {
          win().webContents.send('install:error', msg)
        } catch {
          /* window destroyed */
        }
        return { success: false, error: msg }
      }
    }
  )

  ipcMain.handle('oauth:openai-codex', async () => {
    try {
      await loginOpenAICodex(win())
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { success: false, error: msg }
    }
  })

  // Read config / switch provider
  ipcMain.handle('config:read', async () => {
    try {
      const config = await readCurrentConfig()
      const installerCfg = readInstallerConfig()
      return { success: true, config: { ...config, channels: installerCfg.channels } }
    } catch (e) {
      return { success: false, config: null, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ─── Message channel config ─────────────────────────────────────────────────
  ipcMain.handle(
    'channel:save',
    (
      _e,
      params: {
        channel: 'telegram' | 'lark'
        telegramBotToken?: string
        larkBotToken?: string
        larkBotName?: string
      }
    ) => {
      try {
        const cfg = readInstallerConfig()
        cfg.channels = cfg.channels || {}

        if (params.channel === 'telegram') {
          cfg.channels.enabled = 'telegram'
          cfg.channels.telegram = { botToken: params.telegramBotToken ?? '' }
          cfg.channels.lark = { enabled: false }
        } else {
          cfg.channels.enabled = 'lark'
          cfg.channels.lark = { enabled: true }
          cfg.channels.telegram = {}
        }

        writeInstallerConfig(cfg)
        return { success: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // Configure Telegram bot token and enable the telegram plugin
  ipcMain.handle(
    'channel:configure-telegram',
    async (_e, params: { botToken: string }) => {
      const stepLogs: string[] = []

      const runCommand = (cmdStr: string): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> =>
        new Promise((resolve) => {
          let stdout = ''
          let stderr = ''
          const child = spawn(cmdStr, { env: getPathEnv(), shell: true })
          child.stdout.on('data', (d) => { stdout += d.toString() })
          child.stderr.on('data', (d) => { stderr += d.toString() })
          child.on('close', (code) => {
            resolve({ success: code === 0, stdout, stderr, error: code !== 0 ? 'exit ' + code : undefined })
          })
          child.on('error', (e) => resolve({ success: false, stdout, stderr, error: e.message }))
        })

      try {
        // Step 1: Patch OpenClaw config with Telegram bot token
        stepLogs.push('[telegram] Patching config with bot token...')
        const patch = {
          channels: {
            telegram: {
              enabled: true,
              botToken: params.botToken
            }
          }
        }

        await new Promise<void>((resolve, reject) => {
          const child = spawn(findBin('openclaw'), ['config', 'patch', '--stdin'], {
            env: getPathEnv(),
            stdio: ['pipe', 'pipe', 'pipe']
          })
          let stderr = ''
          child.stderr.on('data', (d) => { stderr += d.toString() })
          child.on('error', reject)
          child.on('close', (code) => {
            if (code === 0) resolve()
            else reject(new Error(stderr.trim() || 'config patch exited ' + code))
          })
          child.stdin.write(JSON.stringify(patch))
          child.stdin.end()
        })
        stepLogs.push('[telegram] Config patch: OK')

        // Step 2: Enable telegram plugin
        stepLogs.push('[telegram] Enabling telegram plugin...')
        const enableResult = await runCommand('openclaw plugins enable telegram')
        if (!enableResult.success) {
          stepLogs.push('[telegram] enable failed: ' + (enableResult.error || enableResult.stderr.slice(0, 200)))
          return { success: false, status: 'enable_failed', logs: stepLogs.join('\n') }
        }
        stepLogs.push('[telegram] Plugin enable: OK')

        // Step 3: Verify
        const listResult = await runCommand('openclaw plugins list')
        const enabled = listResult.stdout.includes('telegram') && listResult.stdout.includes('enabled')
        stepLogs.push(enabled ? '[telegram] Verification: OK (telegram is enabled)' : '[telegram] Verification: NOT enabled')

        return {
          success: enabled,
          status: enabled ? 'success' : 'verify_failed',
          logs: stepLogs.join('\n'),
          verifyOutput: listResult.stdout
        }
      } catch (e) {
        return { success: false, status: 'error', error: e instanceof Error ? e.message : String(e), logs: stepLogs.join('\n') }
      }
    }
  )

  ipcMain.handle('channel:lark-begin-registration', async (_e, domain?: 'feishu' | 'lark') => {
    try {
      const begin = await beginFeishuRegistration(domain || 'feishu')
      return { success: true, ...begin }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // Filter out node/toplesl-await warnings from openclaw output
  const stripWarnings = (s: string): string =>
    s.split('\n').filter((l) => !l.includes('Warning:') && !l.includes('top-level await')).join('\n')

  // ─── Lark/Feishu channel login ───────────────────────────────────────────────────────
  //
  // Full flow has three phases:
  //   phase 1 – start  : spawn openclaw channels login, capture OAuth URL for QR display
  //   phase 2 – poll    : renderer shows QR, polls for command success (scan completed in browser)
  //   phase 3 – install : npm install -g + openclaw plugins install (only after phase 2 success)
  //

  ipcMain.handle('channel:lark-login-start', async (_e, domain?: 'feishu' | 'lark') => {
    return new Promise((resolve) => {
      const selectedDomain = domain || 'feishu'
      let stdout = ''
      let stderr = ''
      let settled = false
      let oauthUrl: string | null = null

      const proc = spawn(findBin('openclaw'), ['channels', 'login', '--channel', selectedDomain], {
        env: getPathEnv(),
        stdio: ['pipe', 'pipe', 'pipe']
      })

      // Accept default "Download from npm" plugin install prompt
      proc.stdin.write('\n')
      proc.stdin.end()

      proc.stdout.on('data', (d) => {
        stdout += d.toString()
        // Try to find an HTTP URL in the output (OAuth authorization URL)
        if (!oauthUrl) {
          const match = stdout.match(/(https?:\/\/[^\s]+\?[^\s]+)/)
          if (match) oauthUrl = match[1]
        }
      })
      proc.stderr.on('data', (d) => { stderr += d.toString() })

      // Give the process ~8 s to emit the OAuth URL, then return
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        proc.kill()
        const rawOut = stripAnsi(stdout)
        const rawErr = stripAnsi(stderr)
        if (oauthUrl) {
          resolve({ success: true, status: 'qr_ready', oauthUrl, output: rawOut, stderr: rawErr })
        } else {
          resolve({
            success: false,
            status: 'no_url',
            output: rawOut,
            stderr: rawErr,
            error: 'Could not capture OAuth URL from openclaw channels login'
          })
        }
      }, 8000)

      proc.on('error', (e) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ success: false, status: 'error', error: e.message })
      })

      proc.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const rawOut = stripAnsi(stdout)
        const rawErr = stripAnsi(stderr)
        // If it already succeeded (e.g. prior session was already auth'd), return success
        const out = stripWarnings(rawOut)
        const configured =
          code === 0 &&
          (out.includes('Bot configured') ||
            out.includes('configured') ||
            out.includes('already exists') ||
            rawOut.includes('Bot configured'))
        if (configured) {
          resolve({ success: true, status: 'already_configured', output: rawOut })
        } else {
          // Return what we have — renderer will poll for completion
          resolve({
            success: false,
            status: 'command_exited',
            code,
            output: rawOut,
            stderr: rawErr,
            error: `Command exited with code ${code}`
          })
        }
      })
    })
  })

  ipcMain.handle('channel:lark-login-wait', async (_e, domain?: 'feishu' | 'lark') => {
    return new Promise((resolve) => {
      const selectedDomain = domain || 'feishu'
      let stdout = ''
      let stderr = ''
      let settled = false

      // Run a fresh login command — it will exit fast if already authenticated
      const proc = spawn(findBin('openclaw'), ['channels', 'login', '--channel', selectedDomain], {
        env: getPathEnv(),
        stdio: ['pipe', 'pipe', 'pipe']
      })

      proc.stdin.write('\n')
      proc.stdin.end()

      proc.stdout.on('data', (d) => { stdout += d.toString() })
      proc.stderr.on('data', (d) => { stderr += d.toString() })

      // Poll for up to 120 s — user scans QR in browser during this time
      const deadline = Date.now() + 120_000

      const checkInterval = setInterval(() => {
        if (settled) { clearInterval(checkInterval); return }
        const rawOut = stripAnsi(stdout)
        const out = stripWarnings(rawOut)
        if (
          out.includes('Bot configured') ||
          out.includes('configured') ||
          rawOut.includes('Bot configured')
        ) {
          clearInterval(checkInterval)
          settled = true
          proc.kill()
          resolve({ success: true, status: 'success', output: rawOut })
          return
        }
        if (Date.now() > deadline) {
          clearInterval(checkInterval)
          settled = true
          proc.kill()
          resolve({ success: false, status: 'timeout', output: rawOut, stderr: stripAnsi(stderr) })
        }
      }, 2000)

      proc.on('error', (e) => {
        if (settled) return
        settled = true
        clearInterval(checkInterval)
        resolve({ success: false, status: 'error', error: e.message })
      })

      proc.on('close', (code) => {
        if (settled) return
        clearInterval(checkInterval)
        settled = true
        const rawOut = stripAnsi(stdout)
        const rawErr = stripAnsi(stderr)
        const out = stripWarnings(rawOut)
        const configured =
          code === 0 &&
          (out.includes('Bot configured') ||
            out.includes('configured') ||
            out.includes('already exists') ||
            rawOut.includes('Bot configured'))
        if (configured) {
          resolve({ success: true, status: 'success', output: rawOut })
        } else {
          resolve({
            success: false,
            status: 'command_exited',
            code,
            output: rawOut,
            stderr: rawErr
          })
        }
      })
    })
  })

  ipcMain.handle('channel:lark-install-plugin', async (_e, _domain?: 'feishu' | 'lark') => {
    const stepLogs: string[] = []

    const runCommand = (cmdStr: string): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> =>
      new Promise((resolve) => {
        let stdout = ''
        let stderr = ''
        const child = spawn(cmdStr, { env: getPathEnv(), shell: true })
        child.stdout.on('data', (d) => { stdout += d.toString() })
        child.stderr.on('data', (d) => { stderr += d.toString() })
        child.on('close', (code) => {
          resolve({ success: code === 0, stdout, stderr, error: code !== 0 ? 'exit ' + code : undefined })
        })
        child.on('error', (e) => resolve({ success: false, stdout, stderr, error: e.message }))
      })

    // The feishu plugin needs to be installed and enabled.
    // Use npmmirror for faster download in China.
    stepLogs.push('[plugin] Installing @openclaw/feishu...')

    // Step 1: Install feishu plugin (with retry for transient network errors)
    let installResult: { success: boolean; stdout: string; stderr: string; error?: string } | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      installResult = await runCommand('npm install -g @openclaw/feishu --registry=https://registry.npmmirror.com')
      if (installResult!.success) break
      stepLogs.push(`[plugin] install attempt ${attempt} failed, retrying in 5s...`)
      await new Promise((r) => setTimeout(r, 5000))
    }
    if (!installResult!.success) {
      stepLogs.push('[plugin] install failed: ' + (installResult!.error || installResult!.stderr.slice(0, 200)))
      return { success: false, status: 'install_failed', logs: stepLogs.join('\n') }
    }
    stepLogs.push('[plugin] install: OK')

    // Step 2: openclaw plugins enable feishu (with retry for timing issues)
    stepLogs.push('[plugin] Enabling feishu plugin...')
    let enableResult: { success: boolean; stdout: string; stderr: string; error?: string } | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      enableResult = await runCommand('openclaw plugins enable feishu')
      if (enableResult.success) break
      stepLogs.push(`[plugin] enable attempt ${attempt} failed, retrying in 3s...`)
      await new Promise((r) => setTimeout(r, 3000))
    }
    if (!enableResult!.success) {
      stepLogs.push('[plugin] enable failed: ' + (enableResult!.error || enableResult!.stderr.slice(0, 200)))
      return { success: false, status: 'enable_failed', logs: stepLogs.join('\n') }
    }
    stepLogs.push('[plugin] enable: OK')


    // Step 2: Verify plugin is now enabled
    const listResult = await runCommand('openclaw plugins list')
    const enabled = listResult.stdout.includes('feishu') && listResult.stdout.includes('enabled')
    stepLogs.push(enabled ? '[plugin] Verification: OK (feishu is enabled)' : '[plugin] Verification: NOT enabled')


    return {
      success: enabled,
      status: enabled ? 'success' : 'verify_failed',
      logs: stepLogs.join('\n'),
      verifyOutput: listResult.stdout
    }
  })

  ipcMain.handle(
    'channel:lark-complete-registration',
    async (
      _e,
      params: {
        deviceCode: string
        interval?: number
        expireIn?: number
        domain?: 'feishu' | 'lark'
        tp?: string
        from?: string
      }
    ) => {
      try {
        if (!params.deviceCode) throw new Error('deviceCode is required')
        const outcome = await pollFeishuRegistration({ ...params, initialDomain: params.domain, tp: params.tp, from: params.from })
        if (outcome.status !== 'success' || !outcome.result) {
          return { success: false, status: outcome.status, error: outcome.message || outcome.status }
        }

        await applyFeishuOpenClawConfig(outcome.result)

        const cfg = readInstallerConfig()
        cfg.channels = cfg.channels || {}
        cfg.channels.enabled = 'lark'
        cfg.channels.lark = { enabled: true }
        cfg.channels.telegram = {}
        writeInstallerConfig(cfg)

        const restartResult = await Promise.race([
          restartGateway(),
          new Promise<{ status: string; error?: string }>((resolve) =>
            setTimeout(() => resolve({ status: 'timeout', error: 'restart timeout after 30s' }), 30000)
          )
        ])

        return {
          success: true,
          status: 'success',
          appId: outcome.result.appId,
          domain: outcome.result.domain,
          openId: outcome.result.openId,
          restart: restartResult.status,
          restartError: restartResult.error
        }
      } catch (e) {
        return { success: false, status: 'error', error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'config:switch-provider',
    async (
      _e,
      config: {
        provider: 'anthropic' | 'google' | 'openai' | 'minimax' | 'glm'
        apiKey?: string
        authMethod?: 'api-key' | 'oauth'
        modelId?: string
      }
    ) => {
      try {
        await switchProvider(win(), config)
        await restartGateway()
        return { success: true }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        try {
          win().webContents.send('install:error', msg)
        } catch {
          /* window destroyed */
        }
        return { success: false, error: msg }
      }
    }
  )

  // Forward Gateway logs to renderer
  setGatewayLogCallback((msg) => {
    try {
      win().webContents.send('gateway:log', msg)
    } catch {
      /* window destroyed */
    }
  })

  ipcMain.handle('gateway:start', async () => {
    try {
      const result = await startGateway()
      const success = result.status === 'started'
      return { success, error: result.error }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('gateway:stop', async () => {
    try {
      await stopGateway()
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('gateway:restart', async () => {
    try {
      const result = await Promise.race([
        restartGateway(),
        new Promise<{ status: string; error?: string }>((resolve) =>
          setTimeout(() => resolve({ status: 'timeout', error: 'restart timeout after 30s' }), 30000)
        )
      ])
      const success = result.status === 'started'
      return { success, error: result.error }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('gateway:status', () => getGatewayStatus())

  ipcMain.handle('troubleshoot:check-port', () => checkPort())
  ipcMain.handle('troubleshoot:doctor-fix', () => runDoctorFix(win()))

  ipcMain.handle('newsletter:subscribe', async (_e, email: string) => {
    try {
      const r = await fetch('https://clawlite.ai/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'app' })
      })
      if (!r.ok) return { success: false }
      const data = await r.json()
      return { success: data.success !== false }
    } catch {
      return { success: false }
    }
  })

  ipcMain.on('system:reboot', () => {
    if (platform() !== 'win32') return

    // Add installer to Windows startup registry before reboot
    const exePath = app.getPath('exe')
    const psCommand = [
      'try {',
      `  Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'ClawLiteInstaller' -Value '"${exePath.replace(/\\/g, '\\\\')}"';`,
      '  exit 0',
      '} catch {',
      '  Write-Output $_.Exception.Message;',
      '  exit 1',
      '}'
    ].join(' ')

    const write = spawnSync('powershell', ['-NoProfile', '-Command', psCommand], {
      shell: true,
      encoding: 'utf8'
    })

    // Only reboot if startup key write succeeded
    if (write.status === 0) {
      const child = spawn('shutdown', ['/r', '/t', '5'], {
        shell: true,
        detached: true,
        stdio: 'ignore'
      })
      child.unref()
    }
  })

  // External link opener
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

  ipcMain.removeHandler('app:version')
  ipcMain.handle('app:version', () => app.getVersion())

  // Auto update IPC
  ipcMain.handle('update:check', () => {
    checkForUpdates()
    return { success: true }
  })

  ipcMain.handle('update:download', () => {
    downloadUpdate()
    return { success: true }
  })

  ipcMain.handle('update:install', () => {
    installUpdate()
    return { success: true }
  })

  // Auto launch IPC
  ipcMain.handle('autolaunch:get', () => ({
    enabled: app.getLoginItemSettings().openAtLogin
  }))

  ipcMain.handle('autolaunch:set', (_e, enabled: boolean) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true
    })
    return { success: true }
  })

  // Uninstall OpenClaw
  ipcMain.handle('uninstall:openclaw', async (_e, opts: { removeConfig: boolean }) => {
    try {
      await uninstallOpenClaw(win(), opts)
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // Backup / restore
  ipcMain.handle('backup:export', () => exportBackup(win()))
  ipcMain.handle('backup:import', () => importBackup(win()))

  // i18n settings
  ipcMain.handle('i18n:get-locale', () => i18nMain.language || getSavedLocale())

  const SUPPORTED_LANGS = ['ko', 'en', 'ja', 'zh']

  ipcMain.handle('i18n:set-language', async (_e, lng: string) => {
    if (!SUPPORTED_LANGS.includes(lng)) {
      return { success: false, error: 'Unsupported language' }
    }
    writeSettings({ language: lng })
    await initI18nMain(lng)
    rebuildTrayMenu()
    return { success: true }
  })

  // ─── Activation ───────────────────────────────────────────────────────────────
  const getActivationPath = (): string => join(app.getPath('userData'), 'activation.json')

  ipcMain.handle('activation:check', async (_event, installerInstanceId?: string) => {
    const path = getActivationPath()
    if (!existsSync(path)) return { activated: false }

    let data: any
    try {
      data = JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      return { activated: false }
    }

    // Always verify entitlement with backend — local file alone is not sufficient
    try {
      const resp = await fetch('https://clawlite.ai/api/installer/activation/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'installer', installerInstanceId: installerInstanceId || undefined }),
        signal: AbortSignal.timeout(8000)
      })
      if (resp.ok) {
        const bootstrap = await resp.json()
        if (bootstrap.entitlement?.status !== 'active') {
          // Backend says not active — revoke local activation file
          try { unlinkSync(path) } catch { /* ignore */ }
          return { activated: false }
        }
      }
      // Network/server error — trust local file (graceful degradation)
    } catch {
      // Could not reach backend — trust local activation file
    }

    return {
      activated: true,
      activationInfo: {
        email: data.email || '',
        licenseType: data.licenseType || 'unknown',
        expiresAt: data.expiresAt || null,
        apiKey: data.apiKey || '',
        baseUrl: data.baseUrl || ''
      }
    }
  })

  ipcMain.handle('activation:logout', () => {
    try {
      const path = getActivationPath()
      if (existsSync(path)) unlinkSync(path)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  ipcMain.handle(
    'activation:save',
    (
      _e,
      info: {
        email: string
        licenseType: 'annual' | 'lifetime' | 'trial' | 'unknown'
        expiresAt: string | null
        apiKey: string
        baseUrl: string
      }
    ) => {
      try {
        const path = getActivationPath()
        writeFileSync(path, JSON.stringify(info, null, 2))

        // Also write clawlite provider config to ~/.openclaw/openclaw.json
        try {
          const openClawDir = join(app.getPath('home'), '.openclaw')
          const openClawConfigPath = join(openClawDir, 'openclaw.json')
          let ocConfig: Record<string, any> = {}
          if (existsSync(openClawConfigPath)) {
            ocConfig = JSON.parse(readFileSync(openClawConfigPath, 'utf-8'))
          }
          // Ensure models.providers.clawlite entry
          ocConfig.models = ocConfig.models || {}
          ocConfig.models.providers = ocConfig.models.providers || {}
          ocConfig.models.providers.clawlite = {
            baseUrl: info.baseUrl,
            apiKey: info.apiKey,
            api: 'openai-completions',
            models: [
              {
                id: 'gpt-5.4',
                name: 'GPT-5.4',
                input: ['text', 'image'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 200000,
                maxTokens: 32000,
                reasoning: true
              }
            ]
          }
          // Set default agent to clawlite
          ocConfig.agents = ocConfig.agents || {}
          ocConfig.agents.defaults = ocConfig.agents.defaults || {}
          ocConfig.agents.defaults.model = 'clawlite/gpt-5.4'
          // Generate and write gateway token if not already present
          if (!ocConfig.gateway) ocConfig.gateway = {}
          if (!ocConfig.gateway.auth) ocConfig.gateway.auth = {}
          if (!ocConfig.gateway.auth.token) {
            ocConfig.gateway.auth.token = randomBytes(32).toString('hex')
          }
          if (!existsSync(openClawDir)) {
            mkdirSync(openClawDir, { recursive: true })
          }
          writeFileSync(openClawConfigPath, JSON.stringify(ocConfig, null, 2), { mode: 0o600 })
        } catch (writeErr) {
          console.error('[activation:save] failed to write openclaw config:', writeErr)
        }

        return { success: true }
      } catch {
        return { success: false }
      }
    }
  )

  // ─── Installer activation (activate.json) ────────────────────────────────────
  const getActivatePath = (): string => join(app.getPath('userData'), 'activate.json')

  ipcMain.handle('installer:load-activate', () => {
    try {
      const path = getActivatePath()
      if (!existsSync(path)) return null
      return JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      return null
    }
  })

  ipcMain.handle(
    'installer:save-activate',
    (
      _e,
      data: {
        accountId: string
        email: string
        apiKey: string
        baseUrl: string
      }
    ) => {
      try {
        // Write activate.json
        const activatePath = getActivatePath()
        writeFileSync(activatePath, JSON.stringify(data, null, 2))

        // Also write clawlite config to ~/.openclaw/openclaw.json
        try {
          const openClawDir = join(app.getPath('home'), '.openclaw')
          const openClawConfigPath = join(openClawDir, 'openclaw.json')
          let ocConfig: Record<string, any> = {}
          if (existsSync(openClawConfigPath)) {
            ocConfig = JSON.parse(readFileSync(openClawConfigPath, 'utf-8'))
          }
          ocConfig.models = ocConfig.models || {}
          ocConfig.models.providers = ocConfig.models.providers || {}
          ocConfig.models.providers.clawlite = {
            baseUrl: data.baseUrl,
            apiKey: data.apiKey,
            api: 'openai-completions',
            models: [
              {
                id: 'gpt-5.4',
                name: 'GPT-5.4',
                input: ['text', 'image'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 200000,
                maxTokens: 32000,
                reasoning: true
              }
            ]
          }
          ocConfig.agents = ocConfig.agents || {}
          ocConfig.agents.defaults = ocConfig.agents.defaults || {}
          ocConfig.agents.defaults.model = 'clawlite/gpt-5.4'
          if (!ocConfig.gateway) ocConfig.gateway = {}
          if (!ocConfig.gateway.auth) ocConfig.gateway.auth = {}
          if (!ocConfig.gateway.auth.token) {
            ocConfig.gateway.auth.token = randomBytes(32).toString('hex')
          }
          if (!existsSync(openClawDir)) {
            mkdirSync(openClawDir, { recursive: true })
          }
          writeFileSync(openClawConfigPath, JSON.stringify(ocConfig, null, 2), { mode: 0o600 })
        } catch (writeErr) {
          console.error('[installer:save-activate] failed to write openclaw config:', writeErr)
        }

        return { success: true }
      } catch {
        return { success: false }
      }
    }
  )

  // ─── Model list ────────────────────────────────────────────────────────────────────
  ipcMain.handle('model:list', async () => {
    try {
      const fetchUrl = 'https://clawlite.ai/api/models'
      let httpResp: { body: string; status: number }
      try {
        httpResp = await httpGet(fetchUrl, 15000)
      } catch (fetchErr) {
        console.error('[model:list] fetch error:', fetchErr)
        return { success: false, models: [], error: String(fetchErr) }
      }

      console.log(`[model:list] fetched ${fetchUrl}, status=${httpResp.status}`)
      if (httpResp.status !== 200) {
        return { success: false, models: [], error: `http_${httpResp.status}` }
      }

      const data = JSON.parse(httpResp.body) as { ok: boolean; models?: Array<{ id: string; name: string; provider: string; contextWindow: number; inputPer1M: number; outputPer1M: number }>; error?: string }

      console.log(`[model:list] parsed ${data.models?.length ?? 0} models, ok=${data.ok}`)
      if (!data.ok || !data.models) {
        return { success: false, models: [], error: data.error || 'fetch_failed' }
      }

      return { success: true, models: data.models }
    } catch (e) {
      return { success: false, models: [], error: String(e) }
    }
  })

  // ─── Model switch (lightweight — just update baseUrl/api/model in openclaw.json) ───
  ipcMain.handle(
    'model:switch',
    (_e, params: { provider: 'openai' | 'anthropic' | 'minimax'; modelId: string }) => {
      const { provider, modelId } = params
      try {
        const openClawDir = join(app.getPath('home'), '.openclaw')
        const openClawConfigPath = join(openClawDir, 'openclaw.json')
        let ocConfig: Record<string, unknown> = {}
        if (existsSync(openClawConfigPath)) {
          ocConfig = JSON.parse(readFileSync(openClawConfigPath, 'utf-8'))
        }

        const existingApiKey =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (ocConfig.models as any)?.providers?.clawlite?.apiKey ?? ''

        const apiBaseUrl =
          provider === 'openai'
            ? 'https://clawlite.ai/api/openai/v1'
            : provider === 'anthropic'
            ? 'https://clawlite.ai/api/claude'
            : 'https://clawlite.ai/api/minimax/v1'
        const api =
          provider === 'openai'
            ? 'openai-completions'
            : provider === 'anthropic'
            ? 'anthropic-messages'
            : 'openai-completions'

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = (ocConfig.models = ocConfig.models || {}) as any
        m.providers = m.providers || {}
        m.providers.clawlite = {
          baseUrl: apiBaseUrl,
          apiKey: existingApiKey,
          api,
          models: [
            {
              id: modelId,
              name: modelId,
              input: ['text', 'image'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 200000,
              maxTokens: 32000,
              reasoning: true
            }
          ]
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = ocConfig.agents as any
        a.defaults = a.defaults || {}
        a.defaults.model = `clawlite/${modelId}`

        writeFileSync(openClawConfigPath, JSON.stringify(ocConfig, null, 2), { mode: 0o600 })
        return { success: true }
      } catch (e) {
        console.error('[model:switch] failed:', e)
        return { success: false, error: String(e) }
      }
    }
  )
}
