import { useState, useEffect, useCallback, useRef, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import LobsterLogo from '../components/LobsterLogo'
import Button from '../components/Button'

type LarkPhase = 'idle' | 'starting' | 'qr' | 'polling' | 'installing' | 'success' | 'error' | 'expired'
type TelegramPhase = 'idle' | 'configuring' | 'success' | 'error'
type ActiveTab = 'feishu' | 'telegram'

interface LarkSetup {
  phase: LarkPhase
  qrUrl?: string
  message?: string
  installLogs?: string
  domain?: 'feishu' | 'lark'
  expireIn?: number
  deviceCode?: string
  startTime?: number
}

interface TelegramSetup {
  phase: TelegramPhase
  message?: string
  error?: string
}

interface Props {
  onNext: () => void
}

// ─── QR Code Modal (extracted to separate component for clarity) ────────────────────────
function QrModal({
  qrCanvasRef,
  larkSetup,
  onRefresh,
  onClose
}: {
  qrCanvasRef: RefObject<HTMLCanvasElement | null>
  larkSetup: LarkSetup
  onRefresh: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation('steps')
  const [remaining, setRemaining] = useState<number | null>(null)
  // Persists across effect re-runs — prevents concurrent auto-refresh calls
  const refreshing = useRef(false)

  // Draw QR code onto canvas whenever qrUrl changes
  useEffect(() => {
    if (!larkSetup.qrUrl || !qrCanvasRef.current) return
    const canvas = qrCanvasRef.current
    QRCode.toCanvas(canvas, larkSetup.qrUrl, { margin: 1, width: 180 }).catch(() => {})
    // New QR loaded — reset auto-refresh guard so next cycle can trigger
    refreshing.current = false
  }, [larkSetup.qrUrl, qrCanvasRef])

  // Tick countdown while QR is visible + auto-refresh before expiry
  useEffect(() => {
    if ((larkSetup.phase !== 'qr' && larkSetup.phase !== 'polling' && larkSetup.phase !== 'expired') || larkSetup.expireIn == null || larkSetup.startTime == null) return
    const { expireIn, startTime } = larkSetup
    const tick = (): void => {
      const elapsed = (Date.now() - startTime) / 1000
      const remaining = Math.max(0, Math.ceil(expireIn - elapsed))
      setRemaining(remaining)
      // Auto-refresh QR when 30 seconds left (only during qr/polling phase, skip if already refreshing)
      if (larkSetup.phase !== 'expired' && remaining > 0 && remaining <= 30 && !refreshing.current) {
        refreshing.current = true
        onRefresh()
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [larkSetup.phase, larkSetup.expireIn, larkSetup.startTime, onRefresh])

  const isExpired = larkSetup.phase === 'expired'
  const mins = remaining !== null ? Math.floor(remaining / 60) : null
  const secs = remaining !== null ? remaining % 60 : null
  const timeLabel = mins !== null && secs !== null ? `${mins}:${String(secs).padStart(2, '0')}` : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="rounded-2xl border border-primary/30 bg-[#0f1923] overflow-hidden shadow-2xl max-w-sm w-full mx-4">
        <div className="h-1 bg-gradient-to-r from-transparent via-primary to-transparent animate-[slide-gradient_2s_linear_infinite]" style={{ backgroundSize: '200% 100%' }}/>
        <div className="p-6 text-center">
          <div className="relative inline-block">
            <canvas ref={qrCanvasRef} className="mx-auto h-[180px] w-[180px] rounded-lg bg-white p-2"/>
            {larkSetup.phase === 'polling' && (
              <div className="absolute inset-0 rounded-lg border-2 border-primary/40 animate-ping pointer-events-none"/>
            )}
            {isExpired && (
              <div className="absolute inset-0 rounded-lg bg-black/60 flex flex-col items-center justify-center gap-1">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span className="text-xs text-error font-semibold">已失效</span>
              </div>
            )}
          </div>
          <p className="mt-4 text-sm text-text font-medium">{isExpired ? '二维码已失效' : larkSetup.message}</p>
          {timeLabel && !isExpired && (
            <p className="mt-1 text-[11px] text-text-muted/50">剩余 {timeLabel}</p>
          )}
          {larkSetup.phase === 'polling' && (
            <div className="mt-3 flex items-center justify-center gap-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }}/>
                <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }}/>
                <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }}/>
              </div>
              <span className="text-xs text-text-muted/60">请在 App 中确认授权</span>
            </div>
          )}
          {isExpired && (
            <button
              onClick={onRefresh}
              className="mt-3 flex items-center justify-center gap-2 mx-auto px-4 py-2 rounded-lg bg-primary hover:bg-primary-light transition-colors text-sm font-semibold"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              刷新二维码
            </button>
          )}
        </div>
        <div className="h-1 bg-gradient-to-r from-transparent via-primary to-transparent animate-[slide-gradient_2s_linear_infinite]" style={{ backgroundSize: '200% 100%' }}/>
        <div className="px-6 pb-5 flex justify-center">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl border border-glass-border text-sm font-semibold hover:border-white/20 hover:bg-white/5 transition-all cursor-pointer"
          >
            {t('common:button.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ChannelConfigStep({ onNext }: Props): React.JSX.Element {
  const { t } = useTranslation('steps')
  const [activeTab, setActiveTab] = useState<ActiveTab>('feishu')
  const [larkSetup, setLarkSetup] = useState<LarkSetup>({ phase: 'idle' })
  const [telegramSetup, setTelegramSetup] = useState<TelegramSetup>({ phase: 'idle' })
  const [botToken, setBotToken] = useState('')
  const [tokenError, setTokenError] = useState('')
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)

  // QR generation + countdown + auto-expire are handled inside QrModal

  const configureLarkBot = useCallback(async (domain: 'feishu' | 'lark' = 'feishu'): Promise<void> => {
    const brandName = domain === 'lark' ? 'Lark' : 'Feishu'
    setLarkSetup({ phase: 'starting', message: `正在连接 ${brandName}...`, domain })

    // Phase 1: Begin registration
    let beginResult: Awaited<ReturnType<typeof window.electronAPI.channel.larkBeginRegistration>>
    try {
      beginResult = await window.electronAPI.channel.larkBeginRegistration(domain)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLarkSetup({ phase: 'error', message: `连接失败：${msg}`, domain })
      return
    }

    if (!beginResult.success || !beginResult.qrUrl || !beginResult.deviceCode) {
      const msg = beginResult.error || `${brandName} 连接失败`
      setLarkSetup({ phase: 'error', message: msg, domain })
      return
    }

    // Phase 2: Show QR code
    setLarkSetup({
      phase: 'qr',
      qrUrl: beginResult.qrUrl,
      message: `请使用 ${brandName} 手机 App 扫描二维码`,
      domain,
      expireIn: beginResult.expireIn,
      deviceCode: beginResult.deviceCode,
      startTime: Date.now()
    })

    // Small delay to let QR render, then switch to polling/waiting state
    await new Promise(resolve => setTimeout(resolve, 500))
    setLarkSetup(prev => ({ ...prev, phase: 'polling', message: `等待授权中` }))

    // Phase 3: Complete registration (this polls internally, may take up to 120s)
    let completeResult: Awaited<ReturnType<typeof window.electronAPI.channel.larkCompleteRegistration>>
    try {
      completeResult = await window.electronAPI.channel.larkCompleteRegistration({
        deviceCode: beginResult.deviceCode,
        interval: beginResult.interval,
        expireIn: beginResult.expireIn,
        domain,
        tp: beginResult.tp,
        from: beginResult.from
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLarkSetup({ phase: 'error', message: `授权异常：${msg}`, domain })
      return
    }

    if (!completeResult.success) {
      const statusMsg = completeResult.status || 'error'
      // expired → keep QR visible with refresh option (not a fatal error)
      if (statusMsg === 'expired') {
        setLarkSetup(prev => ({ ...prev, phase: 'expired' }))
        return
      }
      const errorMap: Record<string, string> = {
        'access_denied': '您拒绝了授权请求',
        'timeout': '授权超时，请重试',
        'error': completeResult.error || '授权失败'
      }
      const msg = errorMap[statusMsg] || `授权失败：${statusMsg}`
      setLarkSetup({ phase: 'error', message: msg, domain })
      return
    }

    // Phase 4: Install plugin
    setLarkSetup(prev => ({ ...prev, phase: 'installing', message: `正在安装 ${brandName} 插件...` }))

    const installResult = await window.electronAPI.channel.larkInstallPlugin(domain)
    if (!installResult.success) {
      setLarkSetup({
        phase: 'error',
        message: `插件安装失败：${installResult.status}`,
        installLogs: installResult.logs,
        domain
      })
      return
    }

    // Success!
    setLarkSetup({ phase: 'success', message: `${brandName} 配置成功！`, domain })
  }, [])

  // Refresh QR code when expired — re-call larkBeginRegistration to get a fresh QR
  const refreshQr = useCallback(async (): Promise<void> => {
    const domain = larkSetup.domain || 'feishu'
    const brandName = domain === 'lark' ? 'Lark' : 'Feishu'
    setLarkSetup(prev => ({ ...prev, phase: 'starting', message: `正在刷新二维码...` }))

    try {
      const result = await window.electronAPI.channel.larkBeginRegistration(domain)
      if (!result.success || !result.qrUrl || !result.deviceCode) {
        setLarkSetup(prev => ({
          ...prev,
          phase: 'error',
          message: result.error || `${brandName} 二维码刷新失败`
        }))
        return
      }
      setLarkSetup({
        phase: 'qr',
        qrUrl: result.qrUrl,
        message: `请使用 ${brandName} 手机 App 扫描二维码`,
        domain,
        expireIn: result.expireIn,
        deviceCode: result.deviceCode,
        startTime: Date.now()
      })

      await new Promise(resolve => setTimeout(resolve, 500))
      setLarkSetup(prev => ({ ...prev, phase: 'polling', message: `等待授权中` }))

      // Start polling again with the new device code
      const completeResult = await window.electronAPI.channel.larkCompleteRegistration({
        deviceCode: result.deviceCode,
        interval: result.interval,
        expireIn: result.expireIn,
        domain,
        tp: result.tp,
        from: result.from
      })

      if (!completeResult.success) {
        const statusMsg = completeResult.status || 'error'
        if (statusMsg === 'expired') {
          setLarkSetup(prev => ({ ...prev, phase: 'expired' }))
          return
        }
        const errorMap: Record<string, string> = {
          'access_denied': '您拒绝了授权请求',
          'timeout': '授权超时，请重试',
          'error': completeResult.error || '授权失败'
        }
        const msg = errorMap[statusMsg] || `授权失败：${statusMsg}`
        setLarkSetup(prev => ({ ...prev, phase: 'error', message: msg }))
        return
      }

      // Phase 4: Install plugin
      setLarkSetup(prev => ({ ...prev, phase: 'installing', message: `正在安装 ${brandName} 插件...` }))
      const installResult = await window.electronAPI.channel.larkInstallPlugin(domain)
      if (!installResult.success) {
        setLarkSetup({
          phase: 'error',
          message: `插件安装失败：${installResult.status}`,
          installLogs: installResult.logs,
          domain
        })
        return
      }
      setLarkSetup({ phase: 'success', message: `${brandName} 配置成功！`, domain })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLarkSetup(prev => ({ ...prev, phase: 'error', message: `刷新失败：${msg}` }))
    }
  }, [larkSetup.domain, larkSetup])

  const validateToken = (token: string): boolean => {
    const tokenPattern = /^\d{8,12}:[A-Za-z0-9_-]{35,36}$/
    return tokenPattern.test(token.trim())
  }

  const handleTokenChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.trim()
    setBotToken(value)
    setTokenError('')
    if (value && !validateToken(value)) {
      setTokenError(t('channelConfig.tokenFormatError'))
    }
  }, [t])

  const configureTelegram = useCallback(async (): Promise<void> => {
    const trimmedToken = botToken.trim()
    
    if (!trimmedToken) {
      setTokenError(t('channelConfig.tokenRequired'))
      return
    }
    
    if (!validateToken(trimmedToken)) {
      setTokenError(t('channelConfig.tokenFormatError'))
      return
    }

    setTelegramSetup({ phase: 'configuring', message: t('channelConfig.configuring') })
    setTokenError('')

    try {
      const result = await window.electronAPI.channel.configureTelegram({ botToken: trimmedToken })
      
      if (result.success) {
        setTelegramSetup({
          phase: 'success',
          message: t('channelConfig.success')
        })
      } else {
        setTelegramSetup({
          phase: 'error',
          message: t('channelConfig.failed'),
          error: result.status || result.error
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setTelegramSetup({
        phase: 'error',
        message: t('channelConfig.failed'),
        error: msg
      })
    }
  }, [botToken, t])

  // Auto-navigate when channel config succeeds
  useEffect(() => {
    if (larkSetup.phase !== 'success') return
    const timer = setTimeout(() => onNext(), 800)
    return () => clearTimeout(timer)
  }, [larkSetup.phase, onNext])

  const handleRetry = useCallback((): void => {
    if (activeTab === 'telegram') {
      setTelegramSetup({ phase: 'idle' })
    } else {
      setLarkSetup({ phase: 'idle' })
    }
  }, [activeTab])

  const isLarkConfiguring = larkSetup.phase !== 'idle' && larkSetup.phase !== 'success'
  const isTelegramConfiguring = telegramSetup.phase === 'configuring'
  const isAnySuccess = larkSetup.phase === 'success' || telegramSetup.phase === 'success'

  return (
    <div className="flex-1 flex flex-col min-h-0 px-8 pt-6">
      <div className="flex-1 overflow-y-auto pb-2">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <LobsterLogo
            state={
              isAnySuccess ? 'success' :
              isLarkConfiguring || isTelegramConfiguring ? 'loading' : 'idle'
            }
            size={48}
          />
          <div>
            <h2 className="text-lg font-extrabold">{t('channelConfig.title')}</h2>
            <p className="text-text-muted text-xs">{t('channelConfig.desc')}</p>
          </div>
        </div>

        {/* Tab buttons */}
        <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-glass-border mb-4">
          {(['feishu', 'telegram'] as ActiveTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              disabled={isLarkConfiguring || isTelegramConfiguring}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:text-text hover:bg-white/5'
              } disabled:opacity-50`}
            >
              {tab === 'feishu' && '飞书'}
              {tab === 'telegram' && 'Telegram'}
            </button>
          ))}
        </div>

        {/* Feishu tab */}
        {activeTab === 'feishu' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-glass-border bg-white/5">
              <div className="w-10 h-10 rounded-lg bg-[#1677FF]/20 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#1677FF">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.22l-2.477 10.65c-.127.47-.455.79-.877.79H9.46c-.422 0-.75-.32-.877-.79L6.106 8.22a.94.94 0 0 1 .877-1.28h10.034c.522 0 .922.516.877 1.28z"/>
                </svg>
              </div>
              <div className="flex-1">
                <span className="text-sm font-bold">{t('channelConfig.feishu')}</span>
                <p className="text-[11px] text-text-muted/60">{t('channelConfig.feishuDesc')}</p>
              </div>
              {larkSetup.phase === 'success' && larkSetup.domain === 'feishu' && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
            </div>
            <button
              onClick={() => configureLarkBot('feishu')}
              disabled={isLarkConfiguring || larkSetup.phase === 'success'}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-semibold"
            >
              {isLarkConfiguring ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                  <span>{larkSetup.message || t('channelConfig.configuring')}</span>
                </>
              ) : (
                <span>{larkSetup.phase === 'success' ? t('channelConfig.success') : t('channelConfig.connectBtn')}</span>
              )}
            </button>
          </div>
        )}



        {/* Telegram tab */}
        {activeTab === 'telegram' && (
          <div className="space-y-3">
            <div className="px-4 py-4 rounded-xl border border-glass-border bg-white/5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-[#26A5E4]/20 flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#26A5E4">
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                  </svg>
                </div>
                <div>
                  <span className="text-sm font-bold">{t('channelConfig.telegram')}</span>
                  <p className="text-[11px] text-text-muted/60">{t('channelConfig.telegramDesc')}</p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-text-muted">{t('channelConfig.botToken')}</label>
                <input
                  type="text"
                  value={botToken}
                  onChange={handleTokenChange}
                  placeholder={t('channelConfig.tokenPlaceholder')}
                  disabled={isTelegramConfiguring}
                  className={`w-full px-3 py-2.5 rounded-lg bg-white/5 border text-sm text-text placeholder:text-text-muted/40 focus:outline-none focus:border-primary/50 transition-colors ${
                    tokenError ? 'border-error/50' : 'border-glass-border'
                  } disabled:opacity-50`}
                />
                {tokenError && (
                  <p className="text-[11px] text-error">{tokenError}</p>
                )}
                <a
                  href="https://docs.openclaw.ai/channels/telegram"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  {t('channelConfig.telegramHelpLink') || '如何获取 Bot Token？'}
                </a>
              </div>

              <button
                onClick={configureTelegram}
                disabled={isTelegramConfiguring || !botToken.trim()}
                className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-semibold"
              >
                {isTelegramConfiguring ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                    <span>{t('channelConfig.configuring')}</span>
                  </>
                ) : (
                  <span>{t('channelConfig.configureBtn')}</span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Success state */}
        {(larkSetup.phase === 'success' || telegramSetup.phase === 'success') && (
          <div className="mt-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-success/10 border border-success/30">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span className="text-sm font-medium text-success">
              {larkSetup.phase === 'success' ? larkSetup.message : telegramSetup.message}
            </span>
          </div>
        )}

        {/* Error state */}
        {(larkSetup.phase === 'error' || telegramSetup.phase === 'error') && (
          <div className="mt-4 flex flex-col gap-2 px-4 py-3 rounded-xl bg-error/10 border border-error/20">
            <div className="flex items-start gap-2">
              <span className="text-sm">⚠️</span>
              <span className="text-xs text-error flex-1">
                {larkSetup.phase === 'error' ? larkSetup.message : telegramSetup.message}
              </span>
            </div>
            <button
              onClick={handleRetry}
              className="mt-1 px-3 py-1.5 rounded-lg bg-error/10 border border-error/20 text-xs font-medium text-error hover:bg-error/20 transition-colors cursor-pointer self-start"
            >
              {t('common:button.retry')}
            </button>
          </div>
        )}
      </div>

      {/* Action footer */}
      <div className="shrink-0 flex justify-between py-3">
        <button
          onClick={onNext}
          disabled={isLarkConfiguring || isTelegramConfiguring}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold text-text-muted hover:text-text hover:bg-white/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          跳过
        </button>
        <Button
          variant="primary"
          size="lg"
          onClick={onNext}
          disabled={isLarkConfiguring || isTelegramConfiguring}
        >
          {t('channelConfig.saveBtn')}
        </Button>
      </div>

      {/* QR Code modal for Lark */}
      {(larkSetup.phase === 'qr' || larkSetup.phase === 'polling' || larkSetup.phase === 'expired') && larkSetup.qrUrl && (
        <QrModal
          qrCanvasRef={qrCanvasRef}
          larkSetup={larkSetup}
          onRefresh={refreshQr}
          onClose={handleRetry}
        />
      )}
    </div>
  )
}
