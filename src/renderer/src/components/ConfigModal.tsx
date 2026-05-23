import { useState, useEffect, useCallback, useRef, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import Button from './Button'

// ─── Types ───────────────────────────────────────────────────────────────────
type LarkPhase = 'idle' | 'starting' | 'qr' | 'polling' | 'installing' | 'success' | 'error' | 'expired'
type TelegramPhase = 'idle' | 'configuring' | 'success' | 'error'
type ChannelTab = 'feishu' | 'telegram'

interface LarkSetup {
  phase: LarkPhase
  qrUrl?: string
  message?: string
  domain?: 'feishu' | 'lark'
  expireIn?: number
  deviceCode?: string
  startTime?: number
}

// ─── QR Code Modal ──────────────────────────────────────────────────────────────
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

  useEffect(() => {
    if (!larkSetup.qrUrl || !qrCanvasRef.current) return
    const canvas = qrCanvasRef.current
    QRCode.toCanvas(canvas, larkSetup.qrUrl, { margin: 1, width: 180 }).catch(() => {})
  }, [larkSetup.qrUrl, qrCanvasRef])

  useEffect(() => {
    if ((larkSetup.phase !== 'qr' && larkSetup.phase !== 'polling' && larkSetup.phase !== 'expired') || larkSetup.expireIn == null || larkSetup.startTime == null) return
    const { expireIn, startTime } = larkSetup
    const tick = (): void => {
      const elapsed = (Date.now() - startTime) / 1000
      setRemaining(Math.max(0, Math.ceil(expireIn - elapsed)))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [larkSetup.phase, larkSetup.expireIn, larkSetup.startTime])

  const isExpired = larkSetup.phase === 'expired'
  const mins = remaining !== null ? Math.floor(remaining / 60) : null
  const secs = remaining !== null ? remaining % 60 : null
  const timeLabel = mins !== null && secs !== null ? `${mins}:${String(secs).padStart(2, '0')}` : null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
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

// ── Shared Model UI (same as ModelConfigStep) ──────────────────────────────

type ProviderId = 'openai' | 'anthropic' | 'minimax'

const PROVIDER_TABS: { id: ProviderId; label: string; logo: React.ReactNode }[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    logo: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.9485 4.9485 0 0 1-2.8766-1.0408 4.8684 4.8684 0 0 1-1.8589-2.0826 4.9854 4.9854 0 0 1-.5829-3.6327 4.9854 4.9854 0 0 1 .5829-3.6327 4.8684 4.8684 0 0 1 1.8589-2.0826 4.9485 4.9485 0 0 1 4.0827-.297 4.981 4.981 0 0 1 3.875 2.7637 4.9863 4.9863 0 0 1 .582 3.9516 4.9854 4.9854 0 0 1-.582 3.6327 4.8684 4.8684 0 0 1-1.8589 2.0826 4.9485 4.9485 0 0 1-4.0827.297z" />
      </svg>
    )
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    logo: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    )
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    logo: <span className="text-white text-xs font-black">M</span>
  }
]

function formatCtx(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(0)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

interface ModelInfo {
  id: string
  name: string
  provider: string
  contextWindow: number
  inputPer1M: number
  outputPer1M: number
}

function ModelSelectorInline({
  currentModelId,
  onSaved
}: {
  currentModelId: string | null
  onSaved?: () => void
}): React.JSX.Element {
  const [provider, setProvider] = useState<ProviderId>('openai')
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (currentModelId) {
      const isAnthropic = currentModelId.includes('claude') || currentModelId.includes('anthropic')
      const isMiniMax = currentModelId.startsWith('MiniMax-') || currentModelId.toLowerCase().includes('minimax')
      setProvider(isAnthropic ? 'anthropic' : isMiniMax ? 'minimax' : 'openai')
      setSelectedModelId(currentModelId)
    }
  }, [currentModelId])

  useEffect(() => {
    setLoading(true)
    setError(null)
    window.electronAPI.model.list().then((r) => {
      if (r.success) {
        setModels(r.models)
        if (!selectedModelId && r.models.length > 0) {
          const first = r.models.find((m) =>
            provider === 'openai'
              ? m.provider === 'openai'
              : provider === 'anthropic'
              ? m.provider === 'anthropic'
              : m.provider === 'minimax'
          )
          if (first) setSelectedModelId(first.id)
        }
      } else {
        setError(r.error || '加载模型列表失败')
      }
    }).catch((e) => setError(String(e))).finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredModels = models.filter((m) => {
    if (provider === 'openai') return m.provider === 'openai'
    if (provider === 'anthropic') return m.provider === 'anthropic'
    if (provider === 'minimax') return m.provider === 'minimax'
    return false
  })

  const handleSwitch = async (): Promise<void> => {
    if (!selectedModelId) return
    setSwitching(true)
    setError(null)
    try {
      const result = await window.electronAPI.model.switch({ provider, modelId: selectedModelId })
      if (result.success) {
        await window.electronAPI.gateway.restart()
        setSaved(true)
        onSaved?.()
      } else {
        setError(result.error || '切换失败')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '切换失败')
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-error/10 border border-error/20 rounded-xl">
          <span className="text-xs text-error">{error}</span>
        </div>
      )}

      {/* Provider tabs */}
      <div className="flex gap-2">
        {PROVIDER_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setProvider(tab.id)
              const first = models.find((m) =>
                tab.id === 'openai'
                  ? m.provider === 'openai'
                  : tab.id === 'anthropic'
                  ? m.provider === 'anthropic'
                  : m.provider === 'minimax'
              )
              setSelectedModelId(first?.id ?? null)
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border transition-all duration-150 cursor-pointer ${
              provider === tab.id
                ? tab.id === 'openai'
                  ? 'bg-primary/10 border-primary/40 text-primary'
                  : tab.id === 'anthropic'
                  ? 'bg-[#f25f4c]/10 border-[#f25f4c]/40 text-[#f25f4c]'
                  : 'bg-[#5B5BD6]/10 border-[#5B5BD6]/40 text-[#5B5BD6]'
                : 'bg-white/5 border-glass-border hover:border-white/20 text-text-muted'
            }`}
          >
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
              tab.id === 'openai'
                ? 'bg-black'
                : tab.id === 'anthropic'
                ? 'bg-gradient-to-br from-[#f25f4c] to-[#ff8700]'
                : 'bg-[#5B5BD6]'
            }`}>
              {tab.logo}
            </div>
            <span className="text-sm font-bold">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Model list */}
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <svg className="animate-spin h-5 w-5 text-text-muted" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      ) : filteredModels.length === 0 ? (
        <div className="text-center py-4 text-xs text-text-muted">暂无可用模型</div>
      ) : (
        <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
          {filteredModels.map((m) => {
            const isSelected = selectedModelId === m.id
            return (
              <button
                key={m.id}
                onClick={() => setSelectedModelId(m.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-150 cursor-pointer text-left ${
                  isSelected
                    ? provider === 'openai'
                      ? 'bg-primary/10 border-primary/40'
                      : provider === 'anthropic'
                      ? 'bg-[#f25f4c]/10 border-[#f25f4c]/40'
                      : 'bg-[#5B5BD6]/10 border-[#5B5BD6]/40'
                    : 'bg-white/5 border-glass-border hover:border-white/20'
                }`}
              >
                <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                  isSelected
                    ? provider === 'openai'
                      ? 'border-primary bg-primary'
                      : provider === 'anthropic'
                      ? 'border-[#f25f4c] bg-[#f25f4c]'
                      : 'border-[#5B5BD6] bg-[#5B5BD6]'
                    : 'border-text-muted/30 bg-transparent'
                }`}>
                  {isSelected && (
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
                      <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-text truncate">{m.name}</div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-[10px] text-text-muted/60 font-mono">ctx:{formatCtx(m.contextWindow)}</span>
                    <span className="text-[10px] text-text-muted/40 font-mono">in ${m.inputPer1M.toFixed(3)} / out ${m.outputPer1M.toFixed(3)}</span>
                  </div>
                </div>
                {isSelected && currentModelId === m.id && (
                  <span className="text-[10px] font-bold text-text-muted/50 shrink-0">CURRENT</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Saved state */}
      {saved && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-success/10 border border-success/30 rounded-xl">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="text-sm font-medium text-success">已切换并保存</span>
        </div>
      )}

      {/* Save button */}
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="sm"
          onClick={handleSwitch}
          disabled={!selectedModelId || switching || selectedModelId === currentModelId}
        >
          {switching ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              切换中...
            </span>
          ) : (
            '保存'
          )}
        </Button>
      </div>
    </div>
  )
}

interface Props {
  onClose: () => void
  onDone: () => void
}

export default function ConfigModal({ onClose, onDone }: Props): React.JSX.Element {
  const { t } = useTranslation('steps')
  const [view, setView] = useState<'home' | 'model' | 'channel'>('home')
  const [channelTab, setChannelTab] = useState<ChannelTab>('feishu')
  const [larkSetup, setLarkSetup] = useState<LarkSetup>({ phase: 'idle' })
  const [telegramPhase, setTelegramPhase] = useState<TelegramPhase>('idle')
  const [telegramError, setTelegramError] = useState<string | null>(null)
  const [botToken, setBotToken] = useState('')
  const [currentModel, setCurrentModel] = useState<string | null>(null)
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)

  // Load current config
  useEffect(() => {
    window.electronAPI.config.read().then((r) => {
      if (r.success && r.config) {
        setCurrentModel(r.config.model || null)
        if (r.config.hasTelegram) setTelegramPhase('success')
        const hasLark = r.config.channels?.enabled === 'lark' || r.config.channels?.lark?.enabled
        if (hasLark) setLarkSetup({ phase: 'success', message: '已配置' })
      }
    })
  }, [])

  // Auto-close modal when Telegram config succeeds
  useEffect(() => {
    if (telegramPhase === 'success') {
      const timer = setTimeout(() => onDone(), 800)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [telegramPhase, onDone])

  // ── Lark / Feishu ──────────────────────────────────────────────────────────
  const configureLarkBot = useCallback(async (domain: 'feishu' | 'lark' = 'feishu'): Promise<void> => {
    const brandName = domain === 'lark' ? 'Lark' : 'Feishu'
    setLarkSetup({ phase: 'starting', message: `正在连接 ${brandName}...`, domain })

    let beginResult: Awaited<ReturnType<typeof window.electronAPI.channel.larkBeginRegistration>>
    try {
      beginResult = await window.electronAPI.channel.larkBeginRegistration(domain)
    } catch (e) {
      setLarkSetup({ phase: 'error', message: `连接失败：${e instanceof Error ? e.message : String(e)}`, domain })
      return
    }

    if (!beginResult.success || !beginResult.qrUrl || !beginResult.deviceCode) {
      setLarkSetup({ phase: 'error', message: beginResult.error || `${brandName} 连接失败`, domain })
      return
    }

    setLarkSetup({
      phase: 'qr',
      qrUrl: beginResult.qrUrl,
      message: `请使用 ${brandName} 手机 App 扫描二维码`,
      domain,
      expireIn: beginResult.expireIn,
      deviceCode: beginResult.deviceCode,
      startTime: Date.now()
    })

    await new Promise(resolve => setTimeout(resolve, 500))
    setLarkSetup(prev => ({ ...prev, phase: 'polling', message: '等待授权中' }))

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
      setLarkSetup({ phase: 'error', message: `授权异常：${e instanceof Error ? e.message : String(e)}`, domain })
      return
    }

    if (!completeResult.success) {
      const statusMsg = completeResult.status || 'error'
      if (statusMsg === 'expired') {
        setLarkSetup(prev => ({ ...prev, phase: 'expired' }))
        return
      }
      setLarkSetup({ phase: 'error', message: completeResult.error || `授权失败：${statusMsg}`, domain })
      return
    }

    setLarkSetup({ phase: 'success', message: `${brandName} 配置成功` })
    window.dispatchEvent(new CustomEvent('config-updated'))
  }, [])

  const handleLarkRefresh = useCallback((): void => {
    if (larkSetup.domain) configureLarkBot(larkSetup.domain)
  }, [larkSetup.domain, configureLarkBot])

  const handleCloseQrModal = useCallback((): void => {
    setLarkSetup({ phase: 'idle' })
  }, [])

  // ── Telegram ────────────────────────────────────────────────────────────────
  const configureTelegram = async (): Promise<void> => {
    if (!botToken.trim()) return
    setTelegramPhase('configuring')
    setTelegramError(null)
    try {
      const result = await window.electronAPI.channel.configureTelegram({ botToken: botToken.trim() })
      if (result.success) {
        setTelegramPhase('success')
        window.dispatchEvent(new CustomEvent('config-updated'))
      } else {
        setTelegramPhase('error')
        setTelegramError(result.logs || result.status || '配置失败')
      }
    } catch (e) {
      setTelegramPhase('error')
      setTelegramError(e instanceof Error ? e.message : String(e))
    }
  }

  const resetTelegram = (): void => {
    setTelegramPhase('idle')
    setTelegramError(null)
  }

  const title =
    view === 'model'
      ? t('modelConfig.title')
      : view === 'channel'
        ? t('channelConfig.title')
        : 'Configure'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 bg-[#1c1c1e] rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            {view !== 'home' && (
              <button
                onClick={() => setView('home')}
                disabled={telegramPhase === 'configuring'}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors text-sm disabled:opacity-40"
              >
                ‹
              </button>
            )}
            <h2 className="text-sm font-bold text-white truncate">{title}</h2>
          </div>
          <button
            onClick={onClose}
            disabled={telegramPhase === 'configuring'}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors text-xs"
          >
            ✕
          </button>
        </div>

        <div className="p-5 max-h-[70vh] overflow-y-auto">
          {view === 'home' && (
            <div className="space-y-3">
              <button
                onClick={() => setView('model')}
                className="w-full flex items-center gap-3 px-4 py-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-primary/40 transition-all duration-200 text-left cursor-pointer"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                    <path d="M12 2a3 3 0 0 0-3 3v1H7a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V9a3 3 0 0 0-3-3h-2V5a3 3 0 0 0-3-3Z" />
                    <path d="M8 13h.01M16 13h.01M10 17h4" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">Model</p>
                  <p className="text-[11px] text-white/50 truncate">{t('modelConfig.desc')}</p>
                </div>
                <span className="text-white/40 text-lg">›</span>
              </button>

              <button
                onClick={() => setView('channel')}
                className="w-full flex items-center gap-3 px-4 py-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-primary/40 transition-all duration-200 text-left cursor-pointer"
              >
                <div className="w-10 h-10 rounded-lg bg-[#1677FF]/15 flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" className="text-[#4f9cff]">
                    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">Channel</p>
                  <p className="text-[11px] text-white/50 truncate">{t('channelConfig.desc')}</p>
                </div>
                <span className="text-white/40 text-lg">›</span>
              </button>
            </div>
          )}

          {view === 'model' && (
            <ModelSelectorInline
              currentModelId={currentModel}
              onSaved={() => {
                window.electronAPI.config.read().then((r) => {
                  if (r.success && r.config) {
                    setCurrentModel(r.config.model || null)
                  }
                  window.dispatchEvent(new CustomEvent('config-updated'))
                })
              }}
            />
          )}

          {view === 'channel' && (
            <div className="space-y-4">
              <p className="text-xs text-white/50">{t('channelConfig.desc')}</p>

              {/* Channel tabs */}
              <div className="flex rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                {(['feishu', 'telegram'] as ChannelTab[]).map((tab) => {
                  const icons: Record<ChannelTab, string> = { feishu: '📎', telegram: '✈️' }
                  const labels: Record<ChannelTab, string> = { feishu: '飞书', telegram: 'Telegram' }
                  return (
                    <button
                      key={tab}
                      onClick={() => setChannelTab(tab)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
                        channelTab === tab
                          ? 'bg-primary/15 text-primary border-t-2 border-primary'
                          : 'text-text-muted hover:bg-white/5'
                      }`}
                    >
                      <span>{icons[tab]}</span>
                      <span>{labels[tab]}</span>
                    </button>
                  )
                })}
              </div>

              {/* ── Feishu ── */}
              {channelTab === 'feishu' && (
                <div className="space-y-3">
                  {larkSetup.phase === 'success' ? (
                    <div className="flex items-center gap-3 px-4 py-4 rounded-xl border border-success/30 bg-success/10">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <div>
                        <p className="text-sm font-bold text-success">飞书已配置</p>
                        <p className="text-[10px] text-white/50">{larkSetup.message}</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-center py-2">
                        <p className="text-sm font-semibold text-white mb-1">飞书 (Feishu)</p>
                        <p className="text-xs text-white/40">使用飞书扫码授权，适合中国大陆用户</p>
                      </div>

                      {larkSetup.phase === 'idle' && (
                        <Button
                          variant="primary"
                          size="sm"
                          className="w-full"
                          onClick={() => configureLarkBot('feishu')}
                        >
                          连接飞书
                        </Button>
                      )}

                      {larkSetup.phase === 'starting' && (
                        <div className="flex items-center justify-center gap-2 py-3 text-xs text-white/50">
                          <div className="w-3 h-3 border border-primary/30 border-t-primary rounded-full animate-spin" />
                          {larkSetup.message || '连接中...'}
                        </div>
                      )}

                      {larkSetup.phase === 'error' && (
                        <div className="flex flex-col gap-2 px-3 py-2 rounded-lg bg-error/10 border border-error/20">
                          <div className="flex items-start gap-2">
                            <span className="text-xs">⚠️</span>
                            <span className="text-xs text-error flex-1">{larkSetup.message}</span>
                          </div>
                          <button
                            onClick={() => configureLarkBot('feishu')}
                            className="self-start px-3 py-1 rounded-lg bg-error/10 border border-error/20 text-xs font-medium text-error hover:bg-error/20 transition-colors cursor-pointer"
                          >
                            重试
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Telegram ── */}
              {channelTab === 'telegram' && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-sm">✈️</div>
                    <div>
                      <p className="text-sm font-bold text-white">Telegram</p>
                      <p className="text-[10px] text-white/40">{t('channel.telegramSubtitle')}</p>
                    </div>
                    {telegramPhase === 'success' && (
                      <span className="ml-auto text-[10px] text-green-400 font-bold">已配置</span>
                    )}
                  </div>

                  {telegramPhase !== 'success' && (
                    <>
                      <input
                        type="text"
                        value={botToken}
                        onChange={(e) => setBotToken(e.target.value)}
                        placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-primary/50"
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={configureTelegram}
                        disabled={!botToken.trim() || telegramPhase === 'configuring'}
                        loading={telegramPhase === 'configuring'}
                      >
                        {telegramPhase === 'configuring' ? '配置中...' : '配置 Telegram'}
                      </Button>
                    </>
                  )}

                  {telegramPhase === 'configuring' && (
                    <div className="flex items-center gap-2 text-xs text-white/50">
                      <div className="w-3 h-3 border border-primary/30 border-t-primary rounded-full animate-spin" />
                      正在配置 Telegram...
                    </div>
                  )}

                  {telegramPhase === 'success' && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 border border-success/30">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span className="text-xs text-success">Telegram 配置成功</span>
                    </div>
                  )}

                  {telegramPhase === 'error' && (
                    <div className="flex flex-col gap-2 px-3 py-2 rounded-lg bg-error/10 border border-error/20">
                      <div className="flex items-start gap-2">
                        <span className="text-xs">⚠️</span>
                        <span className="text-xs text-error flex-1">{telegramError || '配置失败'}</span>
                      </div>
                      <button
                        onClick={resetTelegram}
                        className="self-start px-3 py-1 rounded-lg bg-error/10 border border-error/20 text-xs font-medium text-error hover:bg-error/20 transition-colors cursor-pointer"
                      >
                        重试
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Done */}
              <div className="flex justify-between pt-2">
                <button
                  onClick={onDone}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium text-text-muted hover:text-text hover:bg-white/5 transition-colors"
                >
                  跳过
                </button>
                <Button variant="secondary" size="sm" onClick={onDone}>
                  完成
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* QR Code Modal for Lark/Feishu */}
      {(larkSetup.phase === 'qr' || larkSetup.phase === 'polling' || larkSetup.phase === 'expired') && (
        <QrModal
          qrCanvasRef={qrCanvasRef}
          larkSetup={larkSetup}
          onRefresh={handleLarkRefresh}
          onClose={handleCloseQrModal}
        />
      )}
    </div>
  )
}
