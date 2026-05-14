import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import LobsterLogo from '../components/LobsterLogo'
import Button from '../components/Button'
import LogViewer from '../components/LogViewer'
import ManagementModal from '../components/ManagementModal'
import ProviderSwitchModal from '../components/ProviderSwitchModal'
import ModelSelectModal from '../components/ModelSelectModal'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { useManagement } from '../hooks/useManagement'
import { buildWebChatUrl, describeWebChatLaunch, resolveLaunchToken } from './webchat-launch'

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
  const [showModelSelect, setShowModelSelect] = useState(false)
  const [gatewayToken, setGatewayToken] = useState<string | null>(null)
  const [hasTelegram, setHasTelegram] = useState(false)
  const [installerVersion, setInstallerVersion] = useState<string>('')
  const [currentChannel, setCurrentChannel] = useState<'telegram' | 'lark'>('telegram')
  const [channelSaving, setChannelSaving] = useState(false)
  const [larkSetup, setLarkSetup] = useState<{
    phase: 'idle' | 'qr' | 'polling' | 'success' | 'error'
    qrUrl?: string
    userCode?: string
    deviceCode?: string
    interval?: number
    expireIn?: number
    message?: string
  }>({ phase: 'idle' })

  const statusRef = useRef<'starting' | 'running' | 'stopped'>('starting')
  const lastLogRef = useRef<{ msg: string; ts: number } | null>(null)

  const tRef = useRef<TFunction>(t)
  tRef.current = t

  const { uninstall, backup } = useManagement(setStatus)

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
        const chan = (r.config.channels as { enabled?: string } | undefined)?.enabled
        setCurrentChannel(chan === 'lark' ? 'lark' : 'telegram')
      }
    })
  }, [])

  useEffect(() => {
    loadCurrentConfig()
  }, [loadCurrentConfig])

  const openWebChat = async (): Promise<void> => {
    const base = 'http://127.0.0.1:18789/'
    const appendLog = (msg: string): void => {
      setLogs((prev) => [...prev, msg])
    }

    // Avoid stale UI state blocking WebChat: verify live gateway status once
    if (status !== 'running') {
      const s = await window.electronAPI.gateway.status()
      if (s === 'running') {
        setStatus('running')
      } else {
        appendLog('Gateway is still starting. Trying to open Web Chat anyway...')
      }
    }

    const configResult = await window.electronAPI.config.read()
    const resolvedLaunchToken = resolveLaunchToken({
      stateToken: gatewayToken,
      configToken: configResult.success ? configResult.config?.gatewayToken ?? null : null
    })

    if (resolvedLaunchToken.source === 'config' && resolvedLaunchToken.token) {
      setGatewayToken(resolvedLaunchToken.token)
    }

    appendLog('webchat click received')
    appendLog(`webchat installer version: ${installerVersion || 'unknown'}`)
    appendLog(`webchat gateway status at launch: ${statusRef.current}`)
    appendLog(`webchat token source: ${resolvedLaunchToken.source}`)

    if (!resolvedLaunchToken.token) {
      appendLog('webchat launch aborted: missing token')
      appendLog('Web Chat token missing. Please re-run setup or switch provider.')
      setShowLogs(true)
      return
    }

    appendLog(`webchat token length: ${resolvedLaunchToken.token.length}`)

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
      appendLog('Gateway health check is slow; opening Web Chat URL directly...')
      setShowLogs(true)
    }

    const url = buildWebChatUrl(resolvedLaunchToken.token)
    const launchInfo = describeWebChatLaunch(url)
    appendLog(`webchat url mode: ${launchInfo.mode}`)
    appendLog(`webchat launch url: ${launchInfo.safeUrl}`)

    const openResult = await window.electronAPI.system.openExternal(url)
    appendLog(
      openResult.success
        ? 'webchat openExternal: success'
        : `webchat openExternal: failed: ${openResult.error || 'unknown error'}`
    )
    if (!openResult.success) {
      setShowLogs(true)
    }
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

  const handleChannelSwitch = useCallback(async (channel: 'telegram' | 'lark') => {
    if (channel === currentChannel || channelSaving) return
    setChannelSaving(true)
    try {
      const r = await window.electronAPI.channel.save({ channel })
      if (r.success) setCurrentChannel(channel)
    } finally {
      setChannelSaving(false)
    }
  }, [currentChannel, channelSaving])

  const configureLarkBot = useCallback(async (): Promise<void> => {
    if (channelSaving || larkSetup.phase === 'polling') return
    setChannelSaving(true)
    setShowLogs(true)
    setLogs((prev) => [...prev, 'Starting Lark/Feishu scan-to-create...'])
    try {
      const begin = await window.electronAPI.channel.larkBeginRegistration()
      if (!begin.success || !begin.deviceCode || !begin.qrUrl) {
        const msg = begin.error || 'Failed to create Lark/Feishu QR session'
        setLarkSetup({ phase: 'error', message: msg })
        setLogs((prev) => [...prev, `Lark setup failed: ${msg}`])
        return
      }

      setCurrentChannel('lark')
      setLarkSetup({
        phase: 'qr',
        qrUrl: begin.qrUrl,
        userCode: begin.userCode,
        deviceCode: begin.deviceCode,
        interval: begin.interval,
        expireIn: begin.expireIn,
        message: 'Scan the QR with Lark/Feishu on your phone, then approve bot creation.'
      })
      setLogs((prev) => [...prev, 'Lark/Feishu QR is ready. Waiting for approval...'])

      setLarkSetup((prev) => ({ ...prev, phase: 'polling' }))
      const complete = await window.electronAPI.channel.larkCompleteRegistration({
        deviceCode: begin.deviceCode,
        interval: begin.interval,
        expireIn: begin.expireIn
      })

      if (complete.success) {
        setLarkSetup({
          phase: 'success',
          message: `Lark/Feishu bot configured${complete.domain ? ` (${complete.domain})` : ''}. Gateway restarted.`
        })
        setCurrentChannel('lark')
        setStatus('running')
        setLogs((prev) => [
          ...prev,
          `Lark/Feishu bot configured: ${complete.appId || 'app created'}`,
          complete.restartError ? `Gateway restart warning: ${complete.restartError}` : 'Gateway restarted after Lark setup.'
        ])
        loadCurrentConfig()
      } else {
        const msg = complete.error || complete.status || 'Lark/Feishu setup failed'
        setLarkSetup({ phase: 'error', qrUrl: begin.qrUrl, userCode: begin.userCode, message: msg })
        setLogs((prev) => [...prev, `Lark setup failed: ${msg}`])
      }
    } finally {
      setChannelSaving(false)
    }
  }, [channelSaving, larkSetup.phase, loadCurrentConfig])

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

      {/* OpenClaw update banner removed per user request */}

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

      {/* ─── Message channel selector ─── */}
      <div className="w-full max-w-md">
        <p className="text-[11px] text-text-muted/60 mb-1.5 px-0.5">Message Channel</p>
        <div className="flex gap-2">
          <button
            onClick={() => handleChannelSwitch('telegram')}
            disabled={channelSaving}
            className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer transition-all duration-200 ${
              currentChannel === 'telegram'
                ? 'bg-white/10 border-primary/60'
                : 'bg-white/5 border-glass-border hover:border-glass-border/80'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="#0088cc">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
            <div className="flex-1 text-left">
              <span className="text-[12px] font-bold">Telegram</span>
            </div>
            {currentChannel === 'telegram' && (
              <span className="text-success text-xs">✓</span>
            )}
          </button>
          <button
            onClick={configureLarkBot}
            disabled={channelSaving || larkSetup.phase === 'polling'}
            className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer transition-all duration-200 ${
              currentChannel === 'lark'
                ? 'bg-white/10 border-primary/60'
                : 'bg-white/5 border-glass-border hover:border-glass-border/80'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="#1475E7">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.22l-2.477 10.65c-.127.47-.455.79-.877.79H9.46c-.422 0-.75-.32-.877-.79L6.106 8.22a.94.94 0 0 1 .877-1.28h10.034c.522 0 .922.516.877 1.28z"/>
            </svg>
            <div className="flex-1 text-left">
              <span className="text-[12px] font-bold">Lark</span>
              <span className="block text-[10px] text-text-muted/60">
                {larkSetup.phase === 'polling' ? 'Scan pending' : 'Scan setup'}
              </span>
            </div>
            {larkSetup.phase === 'polling' ? (
              <span className="text-warning text-xs">…</span>
            ) : currentChannel === 'lark' ? (
              <span className="text-success text-xs">✓</span>
            ) : null}
          </button>
        </div>
        {larkSetup.qrUrl && (larkSetup.phase === 'qr' || larkSetup.phase === 'polling' || larkSetup.phase === 'error') && (
          <div className="mt-2 rounded-xl border border-glass-border bg-white/5 p-3 text-center">
            <img
              alt="Lark/Feishu setup QR"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(larkSetup.qrUrl)}`}
              className="mx-auto h-[180px] w-[180px] rounded-lg bg-white p-2"
            />
            <p className="mt-2 text-[11px] text-text-muted/80">
              {larkSetup.message || 'Scan with Lark/Feishu mobile app to create and bind the bot.'}
            </p>
            {larkSetup.userCode && (
              <p className="mt-1 text-[10px] text-text-muted/60">Code: {larkSetup.userCode}</p>
            )}
            <button
              onClick={() => window.electronAPI.system.openExternal(larkSetup.qrUrl!)}
              className="mt-2 text-[11px] text-primary/90 hover:text-primary"
            >
              Open authorization page
            </button>
          </div>
        )}
        {larkSetup.phase === 'success' && larkSetup.message && (
          <p className="mt-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-[11px] text-success">
            {larkSetup.message}
          </p>
        )}
        {larkSetup.phase === 'error' && larkSetup.message && (
          <p className="mt-2 rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-[11px] text-error">
            {larkSetup.message}
          </p>
        )}
      </div>

      {/* ─── Action grid ─── */}
      <div className="w-full max-w-md grid grid-cols-3 gap-2 auto-rows-fr shrink-0">
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
          onClick={() => setShowModelSelect(true)}
          className="glass-card min-w-0 min-h-11 flex items-center gap-2 px-3 py-2 cursor-pointer hover:border-primary/40 transition-all duration-200"
        >
          <span className="text-sm">🤖</span>
          <div className="flex-1 min-w-0 text-left">
            <span className="text-[11px] font-bold truncate block">Model Choose</span>
            {currentModel && (
              <span className="text-[10px] text-text-muted/60 truncate block">{currentModel}</span>
            )}
          </div>
        </button>
        <button
          onClick={uninstall.open}
          className="col-span-3 glass-card min-w-0 min-h-11 flex items-center gap-2 px-3 py-2 cursor-pointer hover:border-error/40 transition-all duration-200"
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

      {/* ─── Model select modal ─── */}
      {showModelSelect && (
        <ModelSelectModal
          currentModelId={currentModel || undefined}
          onClose={() => setShowModelSelect(false)}
          onSuccess={() => {
            loadCurrentConfig()
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
