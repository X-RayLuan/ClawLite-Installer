import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import LobsterLogo from '../components/LobsterLogo'
import Button from '../components/Button'
import LogViewer from '../components/LogViewer'
import ManagementModal from '../components/ManagementModal'
import ProviderSwitchModal from '../components/ProviderSwitchModal'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { useManagement } from '../hooks/useManagement'

const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000 // 30 min

export default function DoneStep({
  botUsername,
  onTroubleshoot,
  onUninstallDone
}: {
  botUsername?: string
  onTroubleshoot?: () => void
  onUninstallDone?: () => void
}): React.JSX.Element {
  const { t } = useTranslation('management')
  const [status, setStatus] = useState<'starting' | 'running' | 'stopped'>('starting')
  const [hasError, setHasError] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [currentModel, setCurrentModel] = useState<string | null>(null)
  const [currentProvider, setCurrentProvider] = useState<string | undefined>()
  const [showProviderModal, setShowProviderModal] = useState(false)
  const [gatewayToken, setGatewayToken] = useState<string | null>(null)
  const [hasTelegram, setHasTelegram] = useState(false)
  const [installerVersion, setInstallerVersion] = useState<string>('')

  // OpenClaw update state
  const [openclawUpdate, setOpenclawUpdate] = useState<{
    current: string
    latest: string
  } | null>(null)
  const [updating, setUpdating] = useState(false)
  const [updateLogs, setUpdateLogs] = useState<string[]>([])
  const updateCheckedRef = useRef(false)
  const lastLogRef = useRef<{ msg: string; ts: number } | null>(null)
  const statusRef = useRef<'starting' | 'running' | 'stopped'>('starting')

  const tRef = useRef<TFunction>(t)
  tRef.current = t

  const { uninstall, backup } = useManagement(setStatus)

  // Check for OpenClaw updates
  const checkOpenclawUpdate = useCallback(async () => {
    try {
      const info = await window.electronAPI.openclaw.checkUpdate()
      if (info.currentVersion && info.latestVersion && info.currentVersion !== info.latestVersion) {
        setOpenclawUpdate({ current: info.currentVersion, latest: info.latestVersion })
      } else {
        setOpenclawUpdate(null)
      }
    } catch {
      /* ignore network errors */
    }
  }, [])

  // Check once when Gateway is running + every 30 min
  useEffect(() => {
    if (status !== 'running') return

    if (!updateCheckedRef.current) {
      updateCheckedRef.current = true
      checkOpenclawUpdate()
    }

    const timer = setInterval(checkOpenclawUpdate, UPDATE_CHECK_INTERVAL)
    return () => clearInterval(timer)
  }, [status, checkOpenclawUpdate])

  // Execute OpenClaw update
  const handleOpenclawUpdate = useCallback(async () => {
    setUpdating(true)
    setUpdateLogs([])

    const unsubProgress = window.electronAPI.install.onProgress((msg) => {
      setUpdateLogs((prev) => [...prev, msg])
    })
    const unsubError = window.electronAPI.install.onError((msg) => {
      setUpdateLogs((prev) => [...prev, tRef.current('done.errorPrefix', { msg })])
    })

    try {
      const result = await window.electronAPI.install.openclaw()
      if (result.success) {
        setUpdateLogs((prev) => [...prev, tRef.current('done.restartingGw')])
        await window.electronAPI.gateway.restart()
        setStatus('running')
        await checkOpenclawUpdate()
      }
    } finally {
      unsubProgress()
      unsubError()
      setUpdating(false)
    }
  }, [checkOpenclawUpdate])

  // Load auto launch settings
  useEffect(() => {
    window.electronAPI.autoLaunch.get().then((r) => setAutoLaunch(r.enabled))
    window.electronAPI.app.version().then((v) => setInstallerVersion(v)).catch(() => {})
  }, [])

  // Read current provider/model
  const loadCurrentConfig = useCallback(() => {
    window.electronAPI.config.read().then((r) => {
      if (r.success && r.config) {
        setCurrentModel(r.config.model || null)
        setCurrentProvider(r.config.provider)
        setGatewayToken(r.config.gatewayToken || null)
        setHasTelegram(Boolean(r.config.hasTelegram))
      }
    })
  }, [])

  useEffect(() => {
    loadCurrentConfig()
  }, [loadCurrentConfig])

  const openWebChat = async (): Promise<void> => {
    const base = 'http://127.0.0.1:18789/'

    // Avoid stale UI state blocking WebChat: verify live gateway status once
    if (status !== 'running') {
      const s = await window.electronAPI.gateway.status()
      if (s === 'running') {
        setStatus('running')
      } else {
        setLogs((prev) => [...prev, 'Gateway is still starting. Trying to open Web Chat anyway...'])
      }
    }

    let token = gatewayToken

    // Re-read config once to avoid race where token is written slightly later
    if (!token) {
      const r = await window.electronAPI.config.read()
      if (r.success && r.config?.gatewayToken) {
        token = r.config.gatewayToken
        setGatewayToken(token)
      }
    }

    if (!token) {
      setLogs((prev) => [...prev, 'Web Chat token missing. Please re-run setup or switch provider.'])
      setShowLogs(true)
      return
    }

    // Preflight readiness retry (2~5s)
    let ready = false
    for (let i = 0; i < 6; i++) {
      try {
        const res = await fetch(base, { method: 'GET' })
        if (res.ok || res.status > 0) {
          ready = true
          break
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 500))
    }

    if (!ready) {
      setLogs((prev) => [...prev, 'Gateway health check is slow; opening Web Chat URL directly...'])
      setShowLogs(true)
    }

    // OpenClaw Control UI currently consumes gateway tokens from the URL hash
    // (`#token=...`) during boot. Passing `?token=...` looks valid, but the UI
    // strips the query param before persisting it, which leaves the token blank
    // and can trigger repeated unauthorized reconnects.
    const url = `${base}#token=${encodeURIComponent(token)}`
    window.electronAPI.system.openExternal(url)
  }

  const toggleAutoLaunch = async (): Promise<void> => {
    const next = !autoLaunch
    await window.electronAPI.autoLaunch.set(next)
    setAutoLaunch(next)
  }

  const downloadLogs = (): void => {
    if (logs.length === 0) return
    const content = logs.join('\n')
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    a.href = url
    a.download = `clawlite-logs-${ts}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    const unsub = window.electronAPI.gateway.onLog((msg) => {
      const now = Date.now()
      const last = lastLogRef.current
      if (last && last.msg === msg && now - last.ts < 1200) return
      lastLogRef.current = { msg, ts: now }

      setLogs((prev) => [...prev, msg])

      // Strip ANSI color codes before classification
      const clean = msg.replace(/\x1b\[[0-9;]*m/g, '').toLowerCase()

      // Ignore known non-fatal network fallback/noise lines
      const ignored =
        clean.includes('fetch fallback') ||
        clean.includes('autoselectfamily') ||
        clean.includes('dnsresultorder=ipv4first') ||
        clean.includes('telegram network unreachable') ||
        clean.includes('continuing setup; fix telegram later') ||
        clean.includes('telegram: failed') ||
        clean.includes('fetch failed') ||
        clean.includes('memory search is enabled but no embedding provider is configured') ||
        clean.includes('gateway memory probe for default agent is not ready') ||
        (clean.includes('gateway health check failed') && statusRef.current === 'starting')

      const isErrorWord = /\berror\b|\bfailed\b|\bfatal\b|\bexception\b/.test(clean)
      const isCoreFailure =
        clean.includes('gateway') ||
        clean.includes('[ws]') ||
        clean.includes('doctor.') ||
        clean.includes('web chat')

      if (isErrorWord && isCoreFailure && !ignored) {
        setHasError(true)
      }
    })
    return unsub
  }, [])

  // Subscribe to Gateway status changes from tray
  useEffect(() => {
    const unsub = window.electronAPI.gateway.onStatusChanged((s) => {
      setStatus(s === 'running' ? 'running' : 'stopped')
    })
    return unsub
  }, [])

  const settleStartResult = useCallback(async (r: { success: boolean; error?: string }) => {
    if (r.success) return r
    await new Promise((x) => setTimeout(x, 1200))
    const s = await window.electronAPI.gateway.status()
    return s === 'running' ? { success: true as const } : r
  }, [])

  useEffect(() => {
    let cancelled = false

    const boot = async (): Promise<void> => {
      const s = await window.electronAPI.gateway.status()
      if (cancelled) return
      if (s === 'running') {
        setStatus('running')
        return
      }

      setStatus('starting')
      const r0 = await window.electronAPI.gateway.start()
      const r = await settleStartResult(r0)
      if (cancelled) return
      setStatus(r.success ? 'running' : 'stopped')
      if (!r.success) {
        const err = (r.error || '').toLowerCase()
        const nonFatal = err.includes('gateway health check failed')
        if (!nonFatal) setHasError(true)
        if (r.error) {
          setLogs((prev) => [...prev, tRef.current('done.errorPrefix', { msg: r.error })])
          setShowLogs(true)
        }
      }
    }
    boot()

    return () => {
      cancelled = true
    }
  }, [settleStartResult])

  const handleStop = async (): Promise<void> => {
    await window.electronAPI.gateway.stop()
    setStatus('stopped')
  }

  const handleStart = async (): Promise<void> => {
    setStatus('starting')
    setLogs([])
    setHasError(false)
    const r0 = await window.electronAPI.gateway.start()
    const r = await settleStartResult(r0)
    setStatus(r.success ? 'running' : 'stopped')
    if (!r.success) {
      const err = (r.error || '').toLowerCase()
      const nonFatal = err.includes('gateway health check failed')
      if (!nonFatal) setHasError(true)
      if (r.error) {
        setLogs((prev) => [...prev, tRef.current('done.errorPrefix', { msg: r.error })])
        setShowLogs(true)
      }
    }
  }

  const handleRestart = useCallback(async (): Promise<void> => {
    setStatus('starting')
    setLogs([])
    setHasError(false)
    const r0 = await window.electronAPI.gateway.restart()
    const r = await settleStartResult(r0)
    setStatus(r.success ? 'running' : 'stopped')
    if (!r.success) {
      const err = (r.error || '').toLowerCase()
      const nonFatal = err.includes('gateway health check failed')
      if (!nonFatal) setHasError(true)
      if (r.error) {
        setLogs((prev) => [...prev, tRef.current('done.errorPrefix', { msg: r.error })])
        setShowLogs(true)
      }
    }
  }, [settleStartResult])

  return (
    <div className="flex-1 flex flex-col items-center justify-start pt-10 px-10 gap-3 overflow-hidden">
      <div className="absolute top-4 right-4 text-right">
        <LanguageSwitcher />
        {installerVersion && <p className="mt-1 text-[10px] text-text-muted/60">Installer v{installerVersion}</p>}
      </div>

      {/* Logo + status */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <div
            className={`absolute inset-0 rounded-full blur-2xl scale-125 transition-colors duration-700 ${
              status === 'running' ? 'bg-success/10' : 'bg-primary/10'
            }`}
          />
          <LobsterLogo
            state={status === 'running' ? 'success' : status === 'starting' ? 'loading' : 'idle'}
            size={44}
          />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full transition-colors duration-500 ${
                status === 'running'
                  ? 'bg-success'
                  : status === 'starting'
                    ? 'bg-warning'
                    : 'bg-text-muted/40'
              }`}
              style={
                status !== 'stopped'
                  ? {
                      animation: 'glow-pulse 2s infinite',
                      color: status === 'running' ? 'var(--color-success)' : 'var(--color-warning)'
                    }
                  : {}
              }
            />
            <span className="text-sm font-bold tracking-wide">
              {status === 'running'
                ? t('done.gatewayRunning')
                : status === 'starting'
                  ? t('done.gatewayStarting')
                  : t('done.gatewayStopped')}
            </span>
          </div>
          {currentModel && (
            <button
              onClick={() => setShowProviderModal(true)}
              className="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
            >
              <span className="text-[11px] text-text-muted">{t('done.aiModel')}</span>
              <span className="text-[11px] font-bold text-primary">{currentModel}</span>
              <span className="text-[10px] text-text-muted/60">{t('done.changeModel')}</span>
            </button>
          )}
        </div>
      </div>

      {/* OpenClaw update banner */}
      <div className="w-full max-w-md min-h-14 shrink-0">
      {(openclawUpdate || updating) && (
        <div className="w-full max-w-md flex items-center gap-3 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-500/15 via-blue-500/10 to-blue-500/15 border border-blue-500/30">
          <span className="text-base">{updating ? '⏳' : '🔄'}</span>
          <div className="flex-1 min-w-0">
            {updating ? (
              <div>
                <span className="text-[12px] font-bold">{t('common:status.updating')}</span>
                {updateLogs.length > 0 && (
                  <p className="text-[11px] text-text-muted/70 truncate">
                    {updateLogs[updateLogs.length - 1]}
                  </p>
                )}
              </div>
            ) : (
              <span className="text-[12px] font-bold">
                {t('done.ocUpdateAvailable', { latest: openclawUpdate!.latest })}
                <span className="text-text-muted/50 font-normal ml-1">
                  ({t('done.ocCurrentVersion', { current: openclawUpdate!.current })})
                </span>
              </span>
            )}
          </div>
          {!updating && (
            <button
              onClick={handleOpenclawUpdate}
              className="px-3 py-1 text-[11px] font-bold rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-all duration-200 cursor-pointer whitespace-nowrap"
            >
              {t('common:button.update')}
            </button>
          )}
        </div>
      )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 min-h-9 items-center mt-2 shrink-0">
        {status === 'running' && hasTelegram && (
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              const url = botUsername ? `https://t.me/${botUsername}` : 'https://telegram.org/'
              window.electronAPI.system.openExternal(url)
            }}
          >
            {t('done.openTelegram')}
          </Button>
        )}
        {status === 'running' ? (
          <>
            <Button variant="secondary" size="sm" onClick={handleRestart}>
              {t('done.restartBtn')}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleStop}>
              {t('done.stopBtn')}
            </Button>
          </>
        ) : status === 'stopped' ? (
          <Button variant="secondary" size="sm" onClick={handleStart}>
            {t('done.startBtn')}
          </Button>
        ) : null}
      </div>

      {/* Gateway logs drawer (isolated at bottom to avoid overlapping controls) */}
      <div className="w-full max-w-md mt-auto shrink-0">
        {logs.length > 0 && (
          <div className="w-full">
            <div className="mb-1 flex items-center justify-between">
              <button
                onClick={() => setShowLogs((v) => !v)}
                className="text-[11px] text-text-muted/60 hover:text-text-muted transition-colors"
              >
                {showLogs ? t('done.hideLog') : t('done.showLog')}
                {hasError && <span className="ml-1.5 text-error">{t('done.errorDetected')}</span>}
              </button>
              <button
                onClick={downloadLogs}
                className="text-[11px] text-primary/80 hover:text-primary transition-colors"
              >
                Download Log
              </button>
            </div>
            <div className={showLogs ? 'h-36 overflow-hidden' : 'h-0 overflow-hidden'}>
              <LogViewer lines={logs} />
            </div>
          </div>
        )}
      </div>

      {/* ─── Web Chat banner ─── */}
      <div className="w-full max-w-md">
        <button
          onClick={openWebChat}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl cursor-pointer bg-white/5 border border-glass-border hover:border-primary/40 hover:bg-white/8 transition-all duration-200"
        >
          <span className="text-lg">🌐</span>
          <div className="flex-1 text-left">
            <span className="text-sm font-bold">Web Chat</span>
            <p className="text-[11px] text-text-muted/70">Open local OpenClaw dashboard</p>
          </div>
        </button>
      </div>

      {/* ─── Action grid ─── */}
      <div className="w-full max-w-md grid grid-cols-2 gap-2 auto-rows-fr shrink-0">
        <button
          onClick={toggleAutoLaunch}
          className="glass-card min-w-0 min-h-11 flex items-center gap-2 px-3 py-2 cursor-pointer hover:border-primary/40 transition-all duration-200"
        >
          <span className="text-sm">⚙️</span>
          <span className="text-[11px] font-bold flex-1 min-w-0 text-left truncate">{t('done.autoLaunch')}</span>
          <div
            className={`w-8 h-4.5 rounded-full p-0.5 transition-colors duration-200 ${
              autoLaunch ? 'bg-primary' : 'bg-white/15'
            }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                autoLaunch ? 'translate-x-3.5' : 'translate-x-0'
              }`}
            />
          </div>
        </button>
        {onTroubleshoot && (
          <button
            onClick={onTroubleshoot}
            className="glass-card min-w-0 min-h-11 flex items-center gap-2 px-3 py-2 cursor-pointer hover:border-primary/40 transition-all duration-200"
          >
            <span className="text-sm">🔧</span>
            <span className="text-[11px] font-bold flex-1 min-w-0 text-left truncate">{t('done.troubleshoot')}</span>
          </button>
        )}
        <button
          onClick={backup.execute}
          className="glass-card min-w-0 min-h-11 flex items-center gap-2 px-3 py-2 cursor-pointer hover:border-primary/40 transition-all duration-200"
        >
          <span className="text-sm">📦</span>
          <span className="text-[11px] font-bold flex-1 min-w-0 text-left truncate">{t('done.backup')}</span>
        </button>
        <button
          onClick={backup.openRestore}
          className="glass-card min-w-0 min-h-11 flex items-center gap-2 px-3 py-2 cursor-pointer hover:border-primary/40 transition-all duration-200"
        >
          <span className="text-sm">📥</span>
          <span className="text-[11px] font-bold flex-1 min-w-0 text-left truncate">{t('done.restore')}</span>
        </button>
        <button
          onClick={uninstall.open}
          className="col-span-2 glass-card min-w-0 min-h-11 flex items-center gap-2 px-3 py-2 cursor-pointer hover:border-error/40 transition-all duration-200"
        >
          <span className="text-sm">🗑️</span>
          <span className="text-[11px] font-bold flex-1 min-w-0 text-left truncate text-error/80">
            {t('done.delete')}
          </span>
        </button>
      </div>

      {/* ─── Uninstall modal ─── */}
      {uninstall.modal && (
        <ManagementModal
          title={t('uninstall.title')}
          phase={uninstall.modal}
          message={uninstall.progress}
          errorMsg={uninstall.error}
          onClose={() => {
            const wasDone = uninstall.modal === 'done'
            uninstall.close()
            if (wasDone) onUninstallDone?.()
          }}
        >
          <div className="space-y-3">
            <p className="text-sm text-text-muted">{t('uninstall.desc')}</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={uninstall.removeConfig}
                onChange={(e) => uninstall.setRemoveConfig(e.target.checked)}
                className="w-4 h-4 rounded border-glass-border accent-primary"
              />
              <span className="text-sm">{t('uninstall.removeConfig')}</span>
            </label>
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={uninstall.close}>
                {t('common:button.cancel')}
              </Button>
              <button
                onClick={uninstall.execute}
                className="px-5 py-2 text-sm font-bold rounded-xl bg-error/20 text-error border border-error/30 hover:bg-error/30 transition-all duration-200 cursor-pointer"
              >
                {t('common:button.delete')}
              </button>
            </div>
          </div>
        </ManagementModal>
      )}

      {/* ─── Restore modal ─── */}
      {backup.restoreModal && (
        <ManagementModal
          title={t('backupRestore.restoreTitle')}
          phase={backup.restoreModal}
          message={backup.restoreMsg}
          errorMsg={backup.restoreMsg}
          onClose={backup.closeRestore}
        >
          <div className="space-y-3">
            <p className="text-sm text-text-muted">{t('backupRestore.restoreDesc')}</p>
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={backup.closeRestore}>
                {t('common:button.cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={backup.executeRestore}>
                {t('backupRestore.selectFile')}
              </Button>
            </div>
          </div>
        </ManagementModal>
      )}

      {/* ─── Backup modal ─── */}
      {backup.backupModal && backup.backupModal !== 'confirm' && (
        <ManagementModal
          title={t('done.settingsBackup')}
          phase={backup.backupModal}
          message={backup.backupMsg}
          errorMsg={backup.backupMsg}
          onClose={backup.closeBackup}
        />
      )}

      {/* ─── Provider switch modal ─── */}
      {showProviderModal && (
        <ProviderSwitchModal
          currentProvider={currentProvider}
          currentModel={currentModel || undefined}
          onClose={() => setShowProviderModal(false)}
          onSuccess={() => {
            loadCurrentConfig()
            // Gateway restart is handled by IPC handler (config:switch-provider)
            setStatus('starting')
            setTimeout(async () => {
              const s = await window.electronAPI.gateway.status()
              setStatus(s === 'running' ? 'running' : 'stopped')
            }, 3000)
          }}
        />
      )}
    </div>
  )
}
