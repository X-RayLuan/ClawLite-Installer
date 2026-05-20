import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import LobsterLogo from '../components/LobsterLogo'
import Button from '../components/Button'

interface Props {
  onNext: () => void
}

interface ModelInfo {
  id: string
  name: string
  provider: string
  contextWindow: number
  inputPer1M: number
  outputPer1M: number
}

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
    logo: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v12M6 12h12" stroke="#5B5BD6" strokeWidth="2" />
      </svg>
    )
  }
]

function formatCtx(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(0)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

export default function ModelConfigStep({ onNext }: Props): React.JSX.Element {
  const { t } = useTranslation('steps')
  const [currentModelId, setCurrentModelId] = useState<string | undefined>()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [provider, setProvider] = useState<ProviderId>('openai')
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Load current model on mount
  useEffect(() => {
    window.electronAPI.config.read().then((r) => {
      if (r.success && r.config?.model) {
        setCurrentModelId(r.config.model)
        const isAnthropic = r.config.model.includes('claude') || r.config.model.includes('anthropic')
        const isMiniMax = r.config.model.startsWith('minimax/')
        setProvider(isAnthropic ? 'anthropic' : isMiniMax ? 'minimax' : 'openai')
        setSelectedModelId(r.config.model)
      }
    })
  }, [])

  // Auto-navigate to next step when model is saved
  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => onNext(), 800)
    return () => clearTimeout(timer)
  }, [saved, onNext])

  // Fetch model list
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
        setCurrentModelId(selectedModelId)
        setSaved(true)
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
    <div className="flex-1 flex flex-col min-h-0 px-8 pt-6">
      <div className="flex-1 overflow-y-auto pb-2">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <LobsterLogo state={saved ? 'success' : 'idle'} size={48} />
          <div>
            <h2 className="text-lg font-extrabold">{t('modelConfig.title')}</h2>
            <p className="text-text-muted text-xs">{t('modelConfig.desc')}</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-error/10 border border-error/20 rounded-xl">
            <span className="text-xs text-error">{error}</span>
          </div>
        )}

        {/* Provider tabs */}
        <div className="flex gap-2 mb-3">
          {PROVIDER_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setProvider(tab.id)
                const first = models.find((m) =>
                  tab.id === 'openai'
                    ? m.id.startsWith('openai/')
                    : tab.id === 'anthropic'
                    ? m.id.includes('claude')
                    : m.id.startsWith('minimax/')
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
                tab.id === 'openai' ? 'bg-black' : tab.id === 'anthropic' ? 'bg-gradient-to-br from-[#f25f4c] to-[#ff8700]' : 'bg-[#5B5BD6]'
              }`}>
                {tab.logo}
              </div>
              <span className="text-sm font-bold">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Model list */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <svg className="animate-spin h-5 w-5 text-text-muted" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="text-center py-6 text-xs text-text-muted">暂无可用模型</div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
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
          <div className="mt-4 flex items-center gap-2 px-4 py-2.5 bg-success/10 border border-success/30 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-sm font-medium text-success">{t('modelConfig.saved')}</span>
          </div>
        )}
      </div>

      {/* Action footer — Skip + Save buttons */}
      <div className="shrink-0 flex justify-end gap-3 py-3">
        <Button
          variant="secondary"
          size="lg"
          onClick={onNext}
        >
          {t('modelConfig.skip')}
        </Button>
        <Button
          variant="primary"
          size="lg"
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
            t('modelConfig.saveBtn')
          )}
        </Button>
      </div>
    </div>
  )
}
