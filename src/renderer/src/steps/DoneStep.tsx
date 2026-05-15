import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import QRCode from 'qrcode'
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
  const [, setCurrentChannel] = useState<'telegram' | 'lark'>('lark')
  const [channelSaving, setChannelSaving] = useState(false)
  const [showChannelChoose, setShowChannelChoose] = useState(false)
  const [larkSetup, setLarkSetup] = useState<{
    phase: 'idle' | 'qr' | 'polling' | 'installing' | 'success' | 'error'
    qrUrl?: string
    oauthUrl?: string
    message?: string
    installLogs?: string
  }>({ phase: 'idle' })

  const statusRef = useRef<'starting' | 'running' | 'stopped'>('starting')
  const lastLogRef = useRef<{ msg: string; ts: number } | null>(null)
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)

  // Generate QR code on canvas when larkSetup.qrUrl changes
  useEffect(() => {
    if (!larkSetup.qrUrl || !qrCanvasRef.current) return
    if (larkSetup.phase !== 'qr' && larkSetup.phase !== 'polling' && larkSetup.phase !== 'error') return
    const canvas = qrCanvasRef.current
    QRCode.toCanvas(canvas, larkSetup.qrUrl, {
      width: 180,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    }).catch(() => {
      /* QR generation failed – skip silently */
    })
  }, [larkSetup.qrUrl, larkSetup.phase])

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
        setCurrentChannel(chan === 'telegram' ? 'telegram' : 'lark')
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

  const configureLarkBot = useCallback(async (domain: 'feishu' | 'lark' = 'feishu'): Promise<void> => {
    if (channelSaving) return
    const brandName = domain === 'lark' ? 'Lark' : 'Feishu'
    setChannelSaving(true)
    setShowLogs(true)
    setShowChannelChoose(false)

    // ─── Phase 1: Start login, capture OAuth URL for QR ───
    setLarkSetup({ phase: 'qr', message: `Starting ${brandName} login...` })
    setLogs((prev) => [...prev, `[${brandName}] Phase 1: Starting openclaw channels login --channel ${domain}...`])

    const startResult = await window.electronAPI.channel.larkLoginStart(domain)
    if (!startResult.success && startResult.status !== 'qr_ready') {
      const msg = startResult.error || `${brandName} login start failed`
      setLarkSetup({ phase: 'error', message: msg })
      setLogs((prev) => [...prev, `[${brandName}] Phase 1 failed: ${msg}`])
      setChannelSaving(false)
      return
    }

    // If already configured (prior auth), go straight to plugin install
    if (startResult.status === 'already_configured') {
      setLogs((prev) => [...prev, `[${brandName}] Already configured — skipping scan.`])
      setLarkSetup({ phase: 'installing', message: 'Already authenticated — installing plugin...' })
    } else {
      // Show QR from captured OAuth URL
      setLarkSetup({
        phase: 'qr',
        oauthUrl: startResult.oauthUrl,
        qrUrl: startResult.oauthUrl,
        message: `Scan the QR code with your ${brandName} mobile app to authorize the bot.`
      })
      setLogs((prev) => [
        ...prev,
        `[${brandName}] Phase 1: QR code ready — scan with ${brandName} app.`,
        startResult.oauthUrl ? `[${brandName}] OAuth URL: ${startResult.oauthUrl}` : ''
      ].filter(Boolean))
    }

    // ─── Phase 2: Wait for scan + auth completion ───
    setLarkSetup((prev) => ({ ...prev, phase: 'polling', message: `Waiting for ${brandName} authorization...` }))
    setLogs((prev) => [...prev, `[${brandName}] Phase 2: Polling for scan completion (up to 120s)...`])

    const waitResult = await window.electronAPI.channel.larkLoginWait(domain)
    if (!waitResult.success) {
      const msg = waitResult.error || waitResult.output || `Authorization timed out or failed`
      setLarkSetup({ phase: 'error', message: msg })
      setLogs((prev) => [...prev, `[${brandName}] Phase 2 failed: ${msg}`])
      setChannelSaving(false)
      return
    }

    setLogs((prev) => [...prev, `[${brandName}] Phase 2: Scan complete — authorization succeeded.`])

    // ─── Phase 3: Install @openclaw/feishu plugin ───
    setLarkSetup({ phase: 'installing', message: 'Scan complete! Installing @openclaw/feishu plugin...' })
    setLogs((prev) => [...prev, `[${brandName}] Phase 3: Installing @openclaw/feishu plugin...`,"npm install -g @openclaw/feishu","openclaw plugins install @openclaw/feishu --dangerously-force-unsafe-install","openclaw plugins list | grep feishu"])

    const installResult = await window.electronAPI.channel.larkInstallPlugin(domain)
    if (!installResult.success) {
      const msg = `Plugin install failed: ${installResult.status}`
      setLarkSetup({ phase: 'error', message: msg, installLogs: installResult.logs })
      setLogs((prev) => [...prev, `[${brandName}] Phase 3 FAILED: ${installResult.logs || installResult.status}`])
      setChannelSaving(false)
      return
    }

    // All three phases succeeded
    setLarkSetup({ phase: 'success', message: `${brandName} setup complete! Plugin installed and enabled.` })
    setCurrentChannel('lark')
    setStatus('running')
    setLogs((prev) => [
      ...prev,
      `[${brandName}] ✓ Phase 3: Plugin verified — @openclaw/feishu is enabled`,
      `[${brandName}] ✓ ${brandName} bot configured and plugin installed successfully.`
    ])
    loadCurrentConfig()
    setChannelSaving(false)
  }, [channelSaving, loadCurrentConfig])

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
        <button
          onClick={() => setShowChannelChoose(true)}
          disabled={larkSetup.phase === 'polling' || larkSetup.phase === 'installing'}
          className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer bg-white/5 border-glass-border hover:border-primary/40 hover:bg-white/8 transition-all duration-200 disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="#1475E7">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.22l-2.477 10.65c-.127.47-.455.79-.877.79H9.46c-.422 0-.75-.32-.877-.79L6.106 8.22a.94.94 0 0 1 .877-1.28h10.034c.522 0 .922.516.877 1.28z"/>
          </svg>
          <div className="flex-1 text-left">
            <span className="text-sm font-bold">Channel Choose</span>
            <p className="text-[11px] text-text-muted/70">
              {larkSetup.phase === 'polling' ? 'Scan pending...' : larkSetup.phase === 'installing' ? 'Installing plugin...' : larkSetup.phase === 'success' ? 'Connected' : larkSetup.phase === 'error' ? 'Setup failed — click to retry' : 'Set up Lark or Feishu bot'}
            </p>
          </div>
          {larkSetup.phase === 'polling' || larkSetup.phase === 'installing' ? (
            <span className="text-warning text-xs animate-pulse">…</span>
          ) : larkSetup.phase === 'success' ? (
            <span className="text-success text-xs">✓</span>
          ) : (
            <span className="text-text-muted text-xs">›</span>
          )}
        </button>

        {larkSetup.qrUrl && (larkSetup.phase === 'qr' || larkSetup.phase === 'polling') && (
          <div className="mt-2 rounded-xl border border-glass-border bg-white/5 p-3 text-center">
            <canvas
              ref={qrCanvasRef}
              className="mx-auto h-[180px] w-[180px] rounded-lg bg-white p-2"
            />
            <p className="mt-2 text-[11px] text-text-muted/80">
              {larkSetup.message || 'Scan with Lark/Feishu mobile app to authorize.'}
            </p>
            {larkSetup.oauthUrl && (
              <button
                onClick={() => window.electronAPI.system.openExternal(larkSetup.oauthUrl!)}
                className="mt-2 text-[11px] text-primary/90 hover:text-primary"
              >
                Open authorization page
              </button>
            )}
          </div>
        )}
        {larkSetup.phase === 'installing' && (
          <div className="mt-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
            {larkSetup.message || 'Installing plugin...'}
            {larkSetup.installLogs && (
              <pre className="mt-1 text-[10px] text-warning/70 whitespace-pre-wrap">{larkSetup.installLogs}</pre>
            )}
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

      {/* ─── Channel Choose modal ─── */}
      {showChannelChoose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4 rounded-2xl border border-glass-border bg-[#1a1a2e] p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">Choose Channel</h3>
              <button
                onClick={() => setShowChannelChoose(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-white/10 transition-all"
              >
                ✕
              </button>
            </div>
            <p className="text-[12px] text-text-muted/70 mb-4">Select a messaging platform to create and bind your bot.</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => configureLarkBot('lark')}
                disabled={channelSaving || larkSetup.phase === 'polling'}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-glass-border bg-white/5 hover:bg-white/10 hover:border-primary/40 cursor-pointer transition-all duration-200 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0" fill="#1475E7">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.22l-2.477 10.65c-.127.47-.455.79-.877.79H9.46c-.422 0-.75-.32-.877-.79L6.106 8.22a.94.94 0 0 1 .877-1.28h10.034c.522 0 .922.516.877 1.28z" />
                </svg>
                <div className="flex-1 text-left">
                  <span className="text-sm font-bold">Lark</span>
                  <p className="text-[11px] text-text-muted/60">字节跳动 Lark（海外版）</p>
                </div>
                <span className="text-text-muted text-sm">›</span>
              </button>
              <button
                onClick={() => configureLarkBot('feishu')}
                disabled={channelSaving || larkSetup.phase === 'polling'}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-glass-border bg-white/5 hover:bg-white/10 hover:border-primary/40 cursor-pointer transition-all duration-200 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0" fill="#1677FF">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.22l-2.477 10.65c-.127.47-.455.79-.877.79H9.46c-.422 0-.75-.32-.877-.79L6.106 8.22a.94.94 0 0 1 .877-1.28h10.034c.522 0 .922.516.877 1.28z" />
                </svg>
                <div className="flex-1 text-left">
                  <span className="text-sm font-bold">Feishu</span>
                  <p className="text-[11px] text-text-muted/60">飞书（字节跳动·国内版）</p>
                </div>
                <span className="text-text-muted text-sm">›</span>
              </button>
            </div>
          </div>
        </div>
      )}

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
