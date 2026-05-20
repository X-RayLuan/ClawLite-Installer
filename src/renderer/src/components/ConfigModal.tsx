import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import Button from './Button'

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

type ChannelPhase = 'idle' | 'starting' | 'qr' | 'polling' | 'installing' | 'success' | 'error'

interface Props {
  onClose: () => void
  onDone: () => void
}

export default function ConfigModal({ onClose, onDone }: Props): React.JSX.Element {
  const { t } = useTranslation('steps')
  const [view, setView] = useState<'home' | 'model' | 'channel'>('home')
  const [larkSetup, setLarkSetup] = useState<{
    phase: ChannelPhase
    qrUrl?: string
    message?: string
    domain?: 'feishu' | 'lark'
  }>({ phase: 'idle' })
  const [channelSaving, setChannelSaving] = useState(false)
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)
  const [currentModel, setCurrentModel] = useState<string | null>(null)
  const [hasTelegram, setHasTelegram] = useState(false)
  const isConfiguringChannel = larkSetup.phase !== 'idle' && larkSetup.phase !== 'success' && larkSetup.phase !== 'error'

  // Load current config
  useEffect(() => {
    window.electronAPI.config.read().then((r) => {
      if (r.success && r.config) {
        setCurrentModel(r.config.model || null)
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
    // Notify DoneStep to refresh its config display
    window.dispatchEvent(new CustomEvent('config-updated'))
  }

  const resetChannel = (): void => {
    setLarkSetup({ phase: 'idle' })
    setChannelSaving(false)
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
                disabled={isConfiguringChannel}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors text-sm disabled:opacity-40"
              >
                ‹
              </button>
            )}
            <h2 className="text-sm font-bold text-white truncate">{title}</h2>
          </div>
          <button
            onClick={onClose}
            disabled={isConfiguringChannel}
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

              <button
                onClick={() => configureLarkBot('feishu')}
                disabled={channelSaving || isConfiguringChannel}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all duration-200 cursor-pointer text-left ${
                  larkSetup.phase !== 'idle' && larkSetup.domain === 'feishu'
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-primary/40'
                } disabled:opacity-50`}
              >
                <div className="w-10 h-10 rounded-lg bg-[#1677FF]/20 flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#1677FF">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.22l-2.477 10.65c-.127.47-.455.79-.877.79H9.46c-.422 0-.75-.32-.877-.79L6.106 8.22a.94.94 0 0 1 .877-1.28h10.034c.522 0 .922.516.877 1.28z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">{t('channelConfig.feishu')}</p>
                  <p className="text-[11px] text-white/50 truncate">{t('channelConfig.feishuDesc')}</p>
                </div>
                {larkSetup.domain === 'feishu' && larkSetup.phase === 'success' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {larkSetup.domain === 'feishu' && isConfiguringChannel && (
                  <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                )}
                {!isConfiguringChannel && larkSetup.domain !== 'feishu' && <span className="text-white/40 text-lg">›</span>}
              </button>

              <button
                onClick={() => configureLarkBot('lark')}
                disabled={channelSaving || isConfiguringChannel}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all duration-200 cursor-pointer text-left ${
                  larkSetup.phase !== 'idle' && larkSetup.domain === 'lark'
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-primary/40'
                } disabled:opacity-50`}
              >
                <div className="w-10 h-10 rounded-lg bg-[#1475E7]/20 flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#1475E7">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.22l-2.477 10.65c-.127.47-.455.79-.877.79H9.46c-.422 0-.75-.32-.877-.79L6.106 8.22a.94.94 0 0 1 .877-1.28h10.034c.522 0 .922.516.877 1.28z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">{t('channelConfig.lark')}</p>
                  <p className="text-[11px] text-white/50 truncate">{t('channelConfig.larkDesc')}</p>
                </div>
                {larkSetup.domain === 'lark' && larkSetup.phase === 'success' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {larkSetup.domain === 'lark' && isConfiguringChannel && (
                  <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                )}
                {!isConfiguringChannel && larkSetup.domain !== 'lark' && <span className="text-white/40 text-lg">›</span>}
              </button>

              {larkSetup.phase === 'starting' && (
                <div className="flex items-center gap-3 px-4 py-4 rounded-xl border border-white/10 bg-white/[0.03]">
                  <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  <span className="text-sm font-medium text-white/80">{larkSetup.message}</span>
                </div>
              )}

              {(larkSetup.phase === 'qr' || larkSetup.phase === 'polling') && larkSetup.qrUrl && (
                <div className="rounded-2xl border border-primary/30 bg-[#0f1923] overflow-hidden shadow-2xl">
                  <div className="h-1 bg-gradient-to-r from-transparent via-primary to-transparent animate-[slide-gradient_2s_linear_infinite]" style={{ backgroundSize: '200% 100%' }} />
                  <div className="p-5 text-center">
                    <div className="relative inline-block">
                      <canvas ref={qrCanvasRef} className="mx-auto h-[180px] w-[180px] rounded-lg bg-white p-2" />
                      {larkSetup.phase === 'polling' && (
                        <div className="absolute inset-0 rounded-lg border-2 border-primary/40 animate-ping pointer-events-none" />
                      )}
                    </div>
                    <p className="mt-4 text-sm text-white font-medium">{larkSetup.message}</p>
                    {larkSetup.phase === 'polling' && (
                      <div className="mt-3 flex items-center justify-center gap-2">
                        <div className="flex gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                        <span className="text-xs text-white/50">请在 App 中确认授权</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {larkSetup.phase === 'installing' && (
                <div className="flex flex-col gap-3 px-4 py-4 rounded-xl border border-primary/20 bg-primary/5">
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    <span className="text-sm font-medium text-primary">{larkSetup.message}</span>
                  </div>
                  <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full animate-[slide_1.5s_ease-in-out_infinite]" style={{ width: '60%' }} />
                  </div>
                </div>
              )}

              {larkSetup.phase === 'success' && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/10 border border-success/30">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span className="text-sm font-medium text-success">{larkSetup.message}</span>
                </div>
              )}

              {larkSetup.phase === 'error' && (
                <div className="flex flex-col gap-2 px-4 py-3 rounded-xl bg-error/10 border border-error/20">
                  <div className="flex items-start gap-2">
                    <span className="text-sm">⚠️</span>
                    <span className="text-xs text-error flex-1">{larkSetup.message}</span>
                  </div>
                  <button
                    onClick={resetChannel}
                    className="mt-1 px-3 py-1.5 rounded-lg bg-error/10 border border-error/20 text-xs font-medium text-error hover:bg-error/20 transition-colors cursor-pointer"
                  >
                    重试
                  </button>
                </div>
              )}

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
