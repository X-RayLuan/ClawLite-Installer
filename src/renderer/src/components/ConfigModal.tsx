import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import Button from './Button'

// ── Shared Model UI (same as ModelConfigStep) ──────────────────────────────

type ProviderId = 'openai' | 'anthropic'

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
      setProvider(isAnthropic ? 'anthropic' : 'openai')
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
            provider === 'openai' ? !m.id.includes('claude') : m.id.includes('claude')
          )
          if (first) setSelectedModelId(first.id)
        }
      } else {
        setError(r.error || '加载模型列表失败')
      }
    }).catch((e) => setError(String(e))).finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredModels = models.filter((m) => {
    if (provider === 'openai') return !m.id.includes('claude')
    if (provider === 'anthropic') return m.id.includes('claude')
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
                tab.id === 'openai' ? !m.id.includes('claude') : m.id.includes('claude')
              )
              setSelectedModelId(first?.id ?? null)
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border transition-all duration-150 cursor-pointer ${
              provider === tab.id
                ? tab.id === 'openai'
                  ? 'bg-primary/10 border-primary/40 text-primary'
                  : 'bg-[#f25f4c]/10 border-[#f25f4c]/40 text-[#f25f4c]'
                : 'bg-white/5 border-glass-border hover:border-white/20 text-text-muted'
            }`}
          >
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
              tab.id === 'openai' ? 'bg-black' : 'bg-gradient-to-br from-[#f25f4c] to-[#ff8700]'
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
                      : 'bg-[#f25f4c]/10 border-[#f25f4c]/40'
                    : 'bg-white/5 border-glass-border hover:border-white/20'
                }`}
              >
                <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                  isSelected
                    ? provider === 'openai'
                      ? 'border-primary bg-primary'
                      : 'border-[#f25f4c] bg-[#f25f4c]'
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
  const [hasTelegram, setHasTelegram] = useState(false)

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
