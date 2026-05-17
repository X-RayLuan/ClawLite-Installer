import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import LobsterLogo from '../components/LobsterLogo'
import Button from '../components/Button'

type ChannelPhase = 'idle' | 'qr' | 'polling' | 'installing' | 'success' | 'error'

interface LarkSetup {
  phase: ChannelPhase
  qrUrl?: string
  oauthUrl?: string
  message?: string
  installLogs?: string
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
    if (larkSetup.phase !== 'qr' && larkSetup.phase !== 'polling' && larkSetup.phase !== 'error') return
    const canvas = qrCanvasRef.current
    QRCode.toCanvas(canvas, larkSetup.qrUrl, { margin: 1, width: 180 }).catch(() => {})
  }, [larkSetup.qrUrl, larkSetup.phase])

  const configureLarkBot = useCallback(async (domain: 'feishu' | 'lark' = 'feishu'): Promise<void> => {
    if (channelSaving) return
    const brandName = domain === 'lark' ? 'Lark' : 'Feishu'
    setChannelSaving(true)
    setLarkSetup({ phase: 'qr', message: `Starting ${brandName} scan-to-create...` })

    let beginResult: Awaited<ReturnType<typeof window.electronAPI.channel.larkBeginRegistration>>
    try {
      beginResult = await window.electronAPI.channel.larkBeginRegistration(domain)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLarkSetup({ phase: 'error', message: msg })
      setChannelSaving(false)
      return
    }

    if (!beginResult.success || !beginResult.qrUrl || !beginResult.deviceCode) {
      const msg = beginResult.error || `${brandName} registration begin failed`
      setLarkSetup({ phase: 'error', message: msg })
      setChannelSaving(false)
      return
    }

    setLarkSetup({
      phase: 'qr',
      qrUrl: beginResult.qrUrl,
      message: `Scan the QR code with your ${brandName} mobile app to authorize the bot.`
    })

    setLarkSetup((prev) => ({ ...prev, phase: 'polling', message: `Waiting for ${brandName} authorization...` }))

    const completeResult = await window.electronAPI.channel.larkCompleteRegistration({
      deviceCode: beginResult.deviceCode,
      interval: beginResult.interval,
      expireIn: beginResult.expireIn
    })
    if (!completeResult.success) {
      const msg = completeResult.error || completeResult.status || `Authorization timed out or failed`
      setLarkSetup({ phase: 'error', message: msg })
      setChannelSaving(false)
      return
    }

    setLarkSetup({ phase: 'installing', message: 'Installing @openclaw/feishu plugin...' })

    const installResult = await window.electronAPI.channel.larkInstallPlugin(domain)
    if (!installResult.success) {
      const msg = `Plugin install failed: ${installResult.status}`
      setLarkSetup({ phase: 'error', message: msg, installLogs: installResult.logs })
      setChannelSaving(false)
      return
    }

    setLarkSetup({ phase: 'success', message: `${brandName} setup complete!` })
    setChannelSaving(false)
  }, [channelSaving])

  const isConfiguring = larkSetup.phase === 'qr' || larkSetup.phase === 'polling' || larkSetup.phase === 'installing'

  return (
    <div className="flex-1 flex flex-col min-h-0 px-8 pt-6">
      <div className="flex-1 overflow-y-auto pb-2">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <LobsterLogo state={larkSetup.phase === 'success' ? 'success' : 'idle'} size={48} />
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
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-glass-border bg-white/5 hover:bg-white/10 hover:border-primary/40 cursor-pointer transition-all duration-200 disabled:opacity-50"
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
            <span className="text-text-muted text-lg">›</span>
          </button>

          {/* Lark */}
          <button
            onClick={() => configureLarkBot('lark')}
            disabled={channelSaving || isConfiguring}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-glass-border bg-white/5 hover:bg-white/10 hover:border-primary/40 cursor-pointer transition-all duration-200 disabled:opacity-50"
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
            <span className="text-text-muted text-lg">›</span>
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

        {/* QR / status overlay */}
        {(larkSetup.phase === 'qr' || larkSetup.phase === 'polling') && larkSetup.qrUrl && (
          <div className="mt-4 p-4 rounded-xl border border-glass-border bg-white/[0.03]">
            <div className="text-center">
              <canvas ref={qrCanvasRef} className="mx-auto h-[180px] w-[180px] rounded-lg bg-white p-2" />
              <p className="mt-3 text-xs text-text-muted/70">{larkSetup.message}</p>
            </div>
          </div>
        )}

        {/* Installing status */}
        {larkSetup.phase === 'installing' && (
          <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/10 border border-primary/20">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-sm font-medium text-primary">{larkSetup.message}</span>
          </div>
        )}

        {/* Success */}
        {larkSetup.phase === 'success' && (
          <div className="mt-4 flex items-center gap-2 px-4 py-2.5 bg-success/10 border border-success/30 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-sm font-medium text-success">{larkSetup.message}</span>
          </div>
        )}

        {/* Error */}
        {larkSetup.phase === 'error' && (
          <div className="mt-4 flex items-start gap-2 px-4 py-2.5 bg-error/10 border border-error/20 rounded-xl">
            <span className="text-sm">⚠️</span>
            <span className="text-xs text-error flex-1">{larkSetup.message}</span>
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
          disabled={isConfiguring || channelSaving}
        >
          {larkSetup.phase === 'success' ? t('common:button.continue') : t('channelConfig.saveBtn')}
        </Button>
      </div>
    </div>
  )
}