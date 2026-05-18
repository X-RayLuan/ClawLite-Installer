import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import Button from './Button'
import ProviderSwitchModal from './ProviderSwitchModal'

type ChannelPhase = 'idle' | 'starting' | 'qr' | 'polling' | 'installing' | 'success' | 'error'

interface Props {
  onClose: () => void
  onDone: () => void
}

export default function ConfigModal({ onClose, onDone }: Props): React.JSX.Element {
  const { t } = useTranslation('steps')
  const [tab, setTab] = useState<'model' | 'channel'>('model')
  const [larkSetup, setLarkSetup] = useState<{
    phase: ChannelPhase
    qrUrl?: string
    message?: string
    domain?: 'feishu' | 'lark'
  }>({ phase: 'idle' })
  const [channelSaving, setChannelSaving] = useState(false)
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)
  const [currentModel, setCurrentModel] = useState<string | null>(null)
  const [currentProvider, setCurrentProvider] = useState<string | undefined>()
  const [hasTelegram, setHasTelegram] = useState(false)

  // Load current config
  useEffect(() => {
    window.electronAPI.config.read().then((r) => {
      if (r.success && r.config) {
        setCurrentModel(r.config.model || null)
        setCurrentProvider(r.config.provider)
        setHasTelegram(Boolean(r.config.hasTelegram))
      }
    })
  }, [])

  // Generate QR when larkSetup changes
  useEffect(() => {
    if (!larkSetup.qrUrl || !qrCanvasRef.current) return
    QRCode.toCanvas(qrCanvasRef.current, larkSetup.qrUrl, { margin: 1, width: 180 }).catch(() => {})
  }, [larkSetup.qrUrl])

  const configureLarkBot = async (domain: 'feishu' | 'lark' = 'feishu'): Promise<void> => {
    if (channelSaving) return
    const brandName = domain === 'lark' ? 'Lark' : 'Feishu'
    setChannelSaving(true)
    setLarkSetup({ phase: 'starting', message: `正在连接 ${brandName}...`, domain })

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
    await new Promise((resolve) => setTimeout(resolve, 500))
    setLarkSetup((prev) => ({ ...prev, phase: 'polling', message: `等待授权中` }))

    // Phase 3: Complete registration (this polls internally, may take up to 120s)
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
    setLarkSetup((prev) => ({ ...prev, phase: 'installing', message: `正在安装 ${brandName} 插件...` }))

    const installResult = await window.electronAPI.channel.larkInstallPlugin(domain)
    if (!installResult.success) {
      setLarkSetup({
        phase: 'error',
        message: `插件安装失败：${installResult.status}`,
        domain
      })
      setChannelSaving(false)
      return
    }

    // Success!
    setLarkSetup({ phase: 'success', message: `${brandName} 配置成功！`, domain })
    setChannelSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 bg-[#1c1c1e] rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-sm font-bold text-white">Configure</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors text-xs"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setTab('model')}
            className={`flex-1 py-3 text-xs font-bold transition-colors ${
              tab === 'model'
                ? 'text-white border-b-2 border-primary'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            Model
          </button>
          <button
            onClick={() => setTab('channel')}
            className={`flex-1 py-3 text-xs font-bold transition-colors ${
              tab === 'channel'
                ? 'text-white border-b-2 border-primary'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            Channel
          </button>
        </div>

        {/* Body */}
        <div className="p-5 max-h-[70vh] overflow-y-auto">
          {/* ── Model Tab ── */}
          {tab === 'model' && (
            <ProviderSwitchModal
              currentProvider={currentProvider}
              currentModel={currentModel || undefined}
              onClose={onClose}
              onSuccess={() => {
                window.electronAPI.config.read().then((r) => {
                  if (r.success && r.config) {
                    setCurrentModel(r.config.model || null)
                    setCurrentProvider(r.config.provider)
                  }
                })
              }}
            />
          )}

          {/* ── Channel Tab ── */}
          {tab === 'channel' && (
            <div className="space-y-4">
              <p className="text-xs text-white/50">{t('channel.description')}</p>

              {/* Feishu */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-sm">📱</div>
                  <div>
                    <p className="text-sm font-bold text-white">Feishu / Lark</p>
                    <p className="text-[10px] text-white/40">{t('channel.feishuSubtitle')}</p>
                  </div>
                </div>

                {(larkSetup.phase === 'idle' || larkSetup.domain !== undefined) && larkSetup.phase !== 'success' && (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      onClick={() => configureLarkBot('feishu')}
                    >
                      配置 Feishu
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      onClick={() => configureLarkBot('lark')}
                    >
                      配置 Lark
                    </Button>
                  </div>
                )}

                {larkSetup.phase === 'starting' && (
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    {larkSetup.message}
                  </div>
                )}

                {(larkSetup.phase === 'qr' || larkSetup.phase === 'polling') && (
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-xs text-white/70">{larkSetup.message}</p>
                    {larkSetup.phase === 'qr' && <canvas ref={qrCanvasRef} className="rounded-lg" />}
                    {larkSetup.phase === 'polling' && (
                      <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    )}
                    <p className="text-[10px] text-white/30">请使用 Feishu / Lark 扫码授权</p>
                  </div>
                )}

                {larkSetup.phase === 'installing' && (
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    {larkSetup.message}
                  </div>
                )}

                {larkSetup.phase === 'success' && (
                  <div className="flex items-center gap-2 text-xs text-green-400">
                    ✓ {larkSetup.message}
                  </div>
                )}

                {larkSetup.phase === 'error' && (
                  <div className="space-y-2">
                    <p className="text-xs text-red-400">{larkSetup.message}</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => configureLarkBot(larkSetup.domain || 'feishu')}
                    >
                      重试
                    </Button>
                  </div>
                )}
              </div>

              {/* Telegram */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-sm">✈️</div>
                  <div>
                    <p className="text-sm font-bold text-white">Telegram</p>
                    <p className="text-[10px] text-white/40">{t('channel.telegramSubtitle')}</p>
                  </div>
                  {hasTelegram && (
                    <span className="ml-auto text-[10px] text-green-400 font-bold">已配置</span>
                  )}
                </div>
                {!hasTelegram && (
                  <p className="text-[10px] text-white/30">请在安装向导中配置 Telegram</p>
                )}
              </div>

              {/* Done */}
              <div className="flex justify-end pt-2">
                <Button variant="secondary" size="sm" onClick={onDone}>
                  完成
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
