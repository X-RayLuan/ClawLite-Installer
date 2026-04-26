type WslState =
  | 'not_available'
  | 'not_installed'
  | 'needs_reboot'
  | 'no_distro'
  | 'not_initialized'
  | 'ready'

interface WizardPersistedState {
  step: string
  wslInstalled: boolean
  timestamp: number
}

interface ElectronAPI {
  version: () => Promise<string>
  env: {
    check: (installerInstanceId?: string) => Promise<{
      os: 'macos' | 'windows' | 'linux'
      nodeInstalled: boolean
      nodeVersion: string | null
      nodeVersionOk: boolean
      openclawInstalled: boolean
      openclawVersion: string | null
      openclawLatestVersion: string | null
      wslState?: WslState
    }>
  }
  install: {
    node: () => Promise<{ success: boolean; error?: string }>
    openclaw: () => Promise<{ success: boolean; error?: string }>
    onProgress: (cb: (msg: string) => void) => () => void
    onError: (cb: (msg: string) => void) => () => void
  }
  onboard: {
    run: (config: {
      provider: 'anthropic' | 'google' | 'openai' | 'minimax' | 'glm'
      apiKey?: string
      authMethod?: 'api-key' | 'oauth'
      telegramBotToken?: string
      modelId?: string
    }) => Promise<{ success: boolean; error?: string; botUsername?: string }>
  }
  oauth: {
    loginCodex: () => Promise<{ success: boolean; error?: string }>
  }
  reboot: () => void
  gateway: {
    start: () => Promise<{ success: boolean; error?: string }>
    stop: () => Promise<{ success: boolean; error?: string }>
    restart: () => Promise<{ success: boolean; error?: string }>
    status: () => Promise<'running' | 'stopped'>
    onLog: (cb: (msg: string) => void) => () => void
    onStatusChanged: (cb: (status: 'running' | 'stopped') => void) => () => void
  }
  troubleshoot: {
    checkPort: () => Promise<{ inUse: boolean; pid?: string }>
    doctorFix: () => Promise<{ success: boolean }>
  }
  wsl: {
    check: () => Promise<WslState>
    install: () => Promise<{ success: boolean; needsReboot?: boolean; error?: string }>
  }
  wizard: {
    saveState: (state: WizardPersistedState) => Promise<{ success: boolean }>
    loadState: () => Promise<WizardPersistedState | null>
    clearState: () => Promise<{ success: boolean }>
  }
  newsletter: {
    subscribe: (email: string) => Promise<{ success: boolean }>
  }
  update: {
    check: (installerInstanceId?: string) => Promise<{ success: boolean }>
    download: () => Promise<{ success: boolean }>
    install: () => Promise<{ success: boolean }>
    onAvailable: (cb: (info: { version: string }) => void) => () => void
    onProgress: (cb: (percent: number) => void) => () => void
    onDownloaded: (cb: () => void) => () => void
    onError: (cb: (msg: string) => void) => () => void
  }
  config: {
    read: () => Promise<{
      success: boolean
      config: { provider?: string; model?: string; hasTelegram?: boolean; gatewayToken?: string } | null
      error?: string
    }>
    switchProvider: (config: {
      provider: 'anthropic' | 'google' | 'openai' | 'minimax' | 'glm'
      apiKey?: string
      authMethod?: 'api-key' | 'oauth'
      modelId?: string
    }) => Promise<{ success: boolean; error?: string }>
  }
  openclaw: {
    checkUpdate: () => Promise<{ currentVersion: string | null; latestVersion: string | null }>
  }
  autoLaunch: {
    get: () => Promise<{ enabled: boolean }>
    set: (enabled: boolean) => Promise<{ success: boolean }>
  }
  system: {
    openExternal: (url: string) => Promise<{ success: boolean; error?: string }>
  }
  app: {
    version: () => Promise<string>
  }
  uninstall: {
    openclaw: (opts: { removeConfig: boolean }) => Promise<{ success: boolean; error?: string }>
    onProgress: (cb: (msg: string) => void) => () => void
  }
  backup: {
    export: () => Promise<{ success: boolean; error?: string }>
    import: () => Promise<{ success: boolean; error?: string }>
  }
  i18n: {
    getLocale: () => Promise<string>
    setLanguage: (lng: string) => Promise<{ success: boolean; error?: string }>
  }
  activation: {
    check: (installerInstanceId?: string) => Promise<{
      activated: boolean
      activationInfo?: {
        email: string
        licenseType: 'annual' | 'lifetime' | 'trial' | 'unknown'
        expiresAt: string | null
        apiKey: string
      }
    }>
    logout: () => Promise<{ success: boolean }>
    save: (info: {
      email: string
      licenseType: 'annual' | 'lifetime' | 'trial' | 'unknown'
      expiresAt: string | null
      apiKey: string
    }) => Promise<{ success: boolean }>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
