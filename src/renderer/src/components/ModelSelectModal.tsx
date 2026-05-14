import { useState, useEffect } from 'react'

type ProviderId = 'openai' | 'anthropic'

interface ModelInfo {
  id: string
  name: string
  provider: string
  contextWindow: number
  inputPer1M: number
  outputPer1M: number
}

interface Props {
  currentModelId?: string
  onClose: () => void
  onSuccess: () => void
}

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

export default function ModelSelectModal({
  currentModelId,
  onClose,
  onSuccess
}: Props): React.JSX.Element {
  const [provider, setProvider] = useState<ProviderId>('openai')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Determine initial provider from current model
  useEffect(() => {
    if (currentModelId) {
      const isAnthropic =
        currentModelId.includes('claude') ||
        currentModelId.includes('anthropic')
      setProvider(isAnthropic ? 'anthropic' : 'openai')
      setSelectedModelId(currentModelId)
    }
  }, [currentModelId])

  // Fetch model list
  useEffect(() => {
    setLoading(true)
    setError(null)
    window.electronAPI.model
      .list()
      .then((r) => {
        if (r.success) {
          setModels(r.models)
          // Auto-select current model if not set
          if (!selectedModelId && r.models.length > 0) {
            const first = r.models.find(
              (m) =>
                m.provider === provider ||
                (provider === 'openai' && !m.provider.includes('claude')) ||
                (provider === 'anthropic' && m.provider.includes('claude'))
            )
            if (first) setSelectedModelId(first.id)
          }
        } else {
          setError(r.error || '加载模型列表失败')
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
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
      const result = await window.electronAPI.model.switch({
        provider,
        modelId: selectedModelId
      })
      if (result.success) {
        // Restart gateway to pick up new model (with 30s timeout)
        await window.electronAPI.gateway.restart()
        onSuccess()
        onClose()
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-md mx-4 p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-black">Model Choose</h3>
            <p className="text-xs text-text-muted mt-0.5">
              选择模型后 Gateway 将自动重启
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

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
                // Select first model of this provider
                const first = models.find((m) =>
                  tab.id === 'openai'
                    ? !m.id.includes('claude')
                    : m.id.includes('claude')
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
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                  tab.id === 'openai' ? 'bg-black' : 'bg-gradient-to-br from-[#f25f4c] to-[#ff8700]'
                }`}
              >
                {tab.logo}
              </div>
              <span className="text-sm font-bold">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Model list */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <svg
              className="animate-spin h-5 w-5 text-text-muted"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                opacity="0.25"
              />
              <path
                d="M12 2a10 10 0 0 1 10 10"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="text-center py-6 text-xs text-text-muted">
            暂无可用模型
          </div>
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
                        : 'bg-[#f25f4c]/10 border-[#f25f4c]/40'
                      : 'bg-white/5 border-glass-border hover:border-white/20'
                  }`}
                >
                  {/* Radio indicator */}
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                      isSelected
                        ? provider === 'openai'
                          ? 'border-primary bg-primary'
                          : 'border-[#f25f4c] bg-[#f25f4c]'
                        : 'border-text-muted/30 bg-transparent'
                    }`}
                  >
                    {isSelected && (
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <path
                          d="M20 6L9 17l-5-5"
                          stroke="white"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>

                  {/* Model info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-text truncate">
                      {m.name}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[10px] text-text-muted/60 font-mono">
                        ctx:{formatCtx(m.contextWindow)}
                      </span>
                      <span className="text-[10px] text-text-muted/40 font-mono">
                        in ${m.inputPer1M.toFixed(3)} / out $
                        {m.outputPer1M.toFixed(3)}
                      </span>
                    </div>
                  </div>

                  {isSelected && (
                    <span className="text-[10px] font-bold text-text-muted/50 shrink-0">
                      CURRENT
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-glass-border hover:border-white/20 text-sm font-semibold transition-all duration-150 cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleSwitch}
            disabled={!selectedModelId || switching}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all duration-150 cursor-pointer disabled:opacity-40 flex items-center justify-center gap-2 ${
              provider === 'openai'
                ? 'bg-primary hover:bg-primary/90'
                : 'bg-[#f25f4c] hover:bg-[#f25f4c]/90'
            }`}
          >
            {switching ? (
              <>
                <svg
                  className="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                    opacity="0.25"
                  />
                  <path
                    d="M12 2a10 10 0 0 1 10 10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
                切换中...
              </>
            ) : (
              '应用'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
