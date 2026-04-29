import { ipcMain, BrowserWindow, app } from 'electron'
import { spawn, spawnSync } from 'child_process'
import { platform } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { randomBytes } from 'crypto'
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
      return { success: true, config }
    } catch (e) {
      return { success: false, config: null, error: e instanceof Error ? e.message : String(e) }
    }
  })

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
      const result = await restartGateway()
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
            models: [
              {
                id: 'gpt-5.4',
                name: 'GPT-5.4',
                input: ['text', 'image'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 1050000,
                maxTokens: 32000,
                reasoning: true
              }
            ]
          }
          // Set default agent to clawlite
          ocConfig.agents = ocConfig.agents || {}
          ocConfig.agents.default = ocConfig.agents.default || {}
          ocConfig.agents.default.provider = 'clawlite'
          ocConfig.agents.default.model = 'gpt-5.4'
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
}
