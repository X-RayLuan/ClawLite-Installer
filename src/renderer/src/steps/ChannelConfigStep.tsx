import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import LobsterLogo from '../components/LobsterLogo'
import Button from '../components/Button'

type ChannelPhase = 'idle' | 'starting' | 'qr' | 'polling' | 'installing' | 'success' | 'error'

interface LarkSetup {
  phase: ChannelPhase
  qrUrl?: string
  message?: string
  installLogs?: string
  domain?: 'feishu' | 'lark'
}

interface Props {
  onNext: () => void
  onBack: () => void
}

export default function ChannelConfigStep({ onNext, onBack }: Props): React.JSX.Element {
  const { t } = useTranslation('steps')
  const [larkSetup, setLarkSetup] = useState<LarkSetup>({ phase: 'idle' })
  const [channelSaving, setChannelSaving] = useState(false)
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)

  // Generate QR when larkSetup changes
  useEffect(() => {
    if (!larkSetup.qrUrl || !qrCanvasRef.current) return
    const canvas = qrCanvasRef.current
    QRCode.toCanvas(canvas, larkSetup.qrUrl, { margin: 1, width: 180 }).catch(() => {})
  }, [larkSetup.qrUrl])

  const configureLarkBot = useCallback(async (domain: 'feishu' | 'lark' = 'feishu'): Promise<void> => {
    if (channelSaving) return
    const brandName = domain === 'lark' ? 'Lark' : 'Feishu'
    setChannelSaving(true)
    setLarkSetup({ phase: 'starting', message: `正在连接 ${brandName}...`, domain })

    // Phase 1: Begin registration
    let beginResult: Awaited<ReturnType<typeof window.electronAPI.channel.larkBeginRegistration>>
    try {
      beginResult = await window.electronAPI.channel.larkBeginRegistration(domain)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLarkSetup({ phase: 'error', message: `连接失败：${msg}`, domain })
      setChannelSaving(false)
      return
    }

    if (!beginResult.success || !beginResult.qrUrl || !beginResult.deviceCode) {
      const msg = beginResult.error || `${brandName} 连接失败`
      setLarkSetup({ phase: 'error', message: msg, domain })
      setChannelSaving(false)
      return
    }

    // Phase 2: Show QR code
    setLarkSetup({
      phase: 'qr',
      qrUrl: beginResult.qrUrl,
      message: `请使用 ${brandName} 手机 App 扫描二维码`,
      domain
    })

    // Small delay to let QR render, then switch to polling/waiting state
    await new Promise(resolve => setTimeout(resolve, 500))
    setLarkSetup(prev => ({ ...prev, phase: 'polling', message: `等待授权中` }))

    // Phase 3: Complete registration (this polls internally, may take up to 120s)
    // We show animated waiting state while it blocks
    let completeResult: Awaited<ReturnType<typeof window.electronAPI.channel.larkCompleteRegistration>>
    try {
      completeResult = await window.electronAPI.channel.larkCompleteRegistration({
        deviceCode: beginResult.deviceCode,
        interval: beginResult.interval,
        expireIn: beginResult.expireIn
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLarkSetup({ phase: 'error', message: `授权异常：${msg}`, domain })
      setChannelSaving(false)
      return
    }

    if (!completeResult.success) {
      const statusMsg = completeResult.status || 'error'
      const errorMap: Record<string, string> = {
        'access_denied': '您拒绝了授权请求',
        'expired': '授权码已过期，请重试',
        'timeout': '授权超时，请重试',
        'error': completeResult.error || '授权失败'
      }
      const msg = errorMap[statusMsg] || `授权失败：${statusMsg}`
      setLarkSetup({ phase: 'error', message: msg, domain })
      setChannelSaving(false)
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
      setChannelSaving(false)
      return
    }

    // Success!
    setLarkSetup({ phase: 'success', message: `${brandName} 配置成功！`, domain })
    setChannelSaving(false)
  }, [channelSaving])

  const handleRetry = useCallback((): void => {
    setLarkSetup({ phase: 'idle' })
    setChannelSaving(false)
  }, [])

  const isConfiguring = larkSetup.phase !== 'idle'

  return (
    <div className="flex-1 flex flex-col min-h-0 px-8 pt-6">
      <div className="flex-1 overflow-y-auto pb-2">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <LobsterLogo
            state={
              larkSetup.phase === 'success' ? 'success' :
              larkSetup.phase === 'starting' || larkSetup.phase === 'installing' ? 'loading' : 'idle'
            }
            size={48}
          />
          <div>
            <h2 className="text-lg font-extrabold">{t('channelConfig.title')}</h2>
            <p className="text-text-muted text-xs">{t('channelConfig.desc')}</p>
          </div>
        </div>

        {/* Platform cards */}
        <div className="space-y-3">
          {/* Feishu */}
          <button
            onClick={() => configureLarkBot('feishu')}
            disabled={channelSaving || isConfiguring}
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all duration-200 cursor-pointer ${
              larkSetup.phase !== 'idle' && larkSetup.domain === 'feishu'
                ? 'border-primary/40 bg-primary/10'
                : 'border-glass-border bg-white/5 hover:bg-white/10 hover:border-primary/40'
            } disabled:opacity-50`}
          >
            <div className="w-10 h-10 rounded-lg bg-[#1677FF]/20 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#1677FF">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.22l-2.477 10.65c-.127.47-.455.79-.877.79H9.46c-.422 0-.75-.32-.877-.79L6.106 8.22a.94.94 0 0 1 .877-1.28h10.034c.522 0 .922.516.877 1.28z" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <span className="text-sm font-bold">{t('channelConfig.feishu')}</span>
              <p className="text-[11px] text-text-muted/60">{t('channelConfig.feishuDesc')}</p>
            </div>
            {larkSetup.domain === 'feishu' && larkSetup.phase === 'success' && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {larkSetup.domain === 'feishu' && isConfiguring && (
              <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            )}
            {!isConfiguring && larkSetup.domain !== 'feishu' && <span className="text-text-muted text-lg">›</span>}
          </button>

          {/* Lark */}
          <button
            onClick={() => configureLarkBot('lark')}
            disabled={channelSaving || isConfiguring}
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all duration-200 cursor-pointer ${
              larkSetup.phase !== 'idle' && larkSetup.domain === 'lark'
                ? 'border-primary/40 bg-primary/10'
                : 'border-glass-border bg-white/5 hover:bg-white/10 hover:border-primary/40'
            } disabled:opacity-50`}
          >
            <div className="w-10 h-10 rounded-lg bg-[#1475E7]/20 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#1475E7">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.22l-2.477 10.65c-.127.47-.455.79-.877.79H9.46c-.422 0-.75-.32-.877-.79L6.106 8.22a.94.94 0 0 1 .877-1.28h10.034c.522 0 .922.516.877 1.28z" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <span className="text-sm font-bold">{t('channelConfig.lark')}</span>
              <p className="text-[11px] text-text-muted/60">{t('channelConfig.larkDesc')}</p>
            </div>
            {larkSetup.domain === 'lark' && larkSetup.phase === 'success' && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {larkSetup.domain === 'lark' && isConfiguring && (
              <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            )}
            {!isConfiguring && larkSetup.domain !== 'lark' && <span className="text-text-muted text-lg">›</span>}
          </button>

          {/* Skip */}
          <button
            onClick={onNext}
            disabled={channelSaving}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-glass-border bg-white/5 hover:bg-white/10 hover:border-white/20 cursor-pointer transition-all duration-200 disabled:opacity-50"
          >
            <span className="text-lg">⏭️</span>
            <div className="flex-1 text-left">
              <span className="text-sm font-bold">{t('channelConfig.skip')}</span>
              <p className="text-[11px] text-text-muted/60">{t('channelConfig.skipDesc')}</p>
            </div>
          </button>
        </div>

        {/* Starting state */}
        {larkSetup.phase === 'starting' && (
          <div className="mt-4 flex items-center gap-3 px-4 py-4 rounded-xl border border-glass-border bg-white/[0.03]">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-sm font-medium text-text">{larkSetup.message}</span>
          </div>
        )}

        {/* QR Code display with animated border */}
        {(larkSetup.phase === 'qr' || larkSetup.phase === 'polling') && larkSetup.qrUrl && (
          <div className="mt-4 rounded-xl border border-primary/30 bg-white/[0.03] overflow-hidden">
            {/* Animated gradient border */}
            <div className="h-1 bg-gradient-to-r from-transparent via-primary to-transparent animate-[slide-gradient_2s_linear_infinite]" style={{ backgroundSize: '200% 100%' }} />
            <div className="p-4 text-center">
              <div className="relative inline-block">
                <canvas ref={qrCanvasRef} className="mx-auto h-[180px] w-[180px] rounded-lg bg-white p-2" />
                {/* Pulsing ring when waiting */}
                {larkSetup.phase === 'polling' && (
                  <div className="absolute inset-0 rounded-lg border-2 border-primary/40 animate-ping pointer-events-none" />
                )}
              </div>
              <p className="mt-3 text-sm text-text font-medium">{larkSetup.message}</p>
              {larkSetup.phase === 'polling' && (
                <div className="mt-2 flex items-center justify-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs text-text-muted/60">请在 App 中确认授权</span>
                </div>
              )}
            </div>
            <div className="h-1 bg-gradient-to-r from-transparent via-primary to-transparent animate-[slide-gradient_2s_linear_infinite]" style={{ backgroundSize: '200% 100%' }} />
          </div>
        )}

        {/* Installing status */}
        {larkSetup.phase === 'installing' && (
          <div className="mt-4 flex flex-col gap-3 px-4 py-4 rounded-xl border border-primary/20 bg-primary/5">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <span className="text-sm font-medium text-primary">{larkSetup.message}</span>
            </div>
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full animate-[slide_1.5s_ease-in-out_infinite]" style={{ width: '60%' }} />
            </div>
          </div>
        )}

        {/* Success */}
        {larkSetup.phase === 'success' && (
          <div className="mt-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-success/10 border border-success/30">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-sm font-medium text-success">{larkSetup.message}</span>
          </div>
        )}

        {/* Error with retry */}
        {larkSetup.phase === 'error' && (
          <div className="mt-4 flex flex-col gap-2 px-4 py-3 rounded-xl bg-error/10 border border-error/20">
            <div className="flex items-start gap-2">
              <span className="text-sm">⚠️</span>
              <span className="text-xs text-error flex-1">{larkSetup.message}</span>
            </div>
            <button
              onClick={handleRetry}
              className="mt-1 px-3 py-1.5 rounded-lg bg-error/10 border border-error/20 text-xs font-medium text-error hover:bg-error/20 transition-colors cursor-pointer"
            >
              重试
            </button>
          </div>
        )}
      </div>

      {/* Action footer */}
      <div className="shrink-0 flex justify-between py-3">
        <button
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl border border-glass-border text-sm font-semibold hover:border-white/20 hover:bg-white/5 transition-all cursor-pointer"
        >
          {t('common:button.back')}
        </button>
        <Button
          variant="primary"
          size="lg"
          onClick={onNext}
          disabled={isConfiguring}
        >
          {larkSetup.phase === 'success' ? t('common:button.continue') : t('channelConfig.saveBtn')}
        </Button>
      </div>
    </div>
  )
}
