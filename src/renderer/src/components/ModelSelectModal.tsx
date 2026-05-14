import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { providerConfigs } from '../constants/providers'

interface Props {
  currentProvider?: string
  currentModel?: string
  onClose: () => void
  onSuccess: () => void
}

type QuickProvider = 'openai' | 'anthropic'

export default function ModelSelectModal({
  currentProvider,
  onClose,
  onSuccess
}: Props): React.JSX.Element {
  const { t } = useTranslation('management')
  const [loading, setLoading] = useState<QuickProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSelect = async (providerId: QuickProvider): Promise<void> => {
    setLoading(providerId)
    setError(null)
    try {
      const cfg = providerConfigs.find((p) => p.id === providerId)!
      const defaultModel = cfg.models[0].id

      const isSameProvider = currentProvider === providerId

      if (isSameProvider) {
        const result = await window.electronAPI.config.switchProvider({
          provider: providerId,
          modelId: defaultModel
        })
        if (result.success) {
          onSuccess()
          onClose()
        } else {
          setError(result.error || t('common:error.occurred'))
        }
      } else {
        setError('请通过"切换 Provider"功能来更换不同模型服务商。')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common:error.unknown'))
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-sm mx-4 p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-black">选择模型</h3>
            <p className="text-xs text-text-muted mt-0.5">选择要使用的 AI 模型</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 bg-error/10 border border-error/20 rounded-xl">
            <span className="text-xs text-error">{error}</span>
          </div>
        )}

        {/* Provider cards */}
        <div className="space-y-3">
          {/* GPT / OpenAI */}
          <button
            onClick={() => handleSelect('openai')}
            disabled={loading !== null}
            className={`w-full py-4 rounded-xl border transition-all duration-150 flex items-center gap-4 px-5 disabled:opacity-50 ${
              loading === 'openai'
                ? 'bg-primary/10 border-primary/60'
                : currentProvider === 'openai'
                  ? 'bg-primary/10 border-primary/40'
                  : 'bg-white/5 border-glass-border hover:border-primary/40 hover:bg-white/[0.08]'
            }`}
          >
            <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.9485 4.9485 0 0 1-2.8766-1.0408 4.8684 4.8684 0 0 1-1.8589-2.0826 4.9854 4.9854 0 0 1-.5829-3.6327 4.9854 4.9854 0 0 1 .5829-3.6327 4.8684 4.8684 0 0 1 1.8589-2.0826 4.9485 4.9485 0 0 1 4.0827-.297 4.981 4.981 0 0 1 3.875 2.7637 4.9863 4.9863 0 0 1 .582 3.9516 4.9854 4.9854 0 0 1-.582 3.6327 4.8684 4.8684 0 0 1-1.8589 2.0826 4.9485 4.9485 0 0 1-4.0827.297z" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <div className="text-base font-black text-text">GPT</div>
              <div className="text-sm text-text-muted/70 font-medium">gpt-5.2</div>
              <div className="text-xs text-text-muted/50 mt-0.5">OpenAI 兼容 API</div>
            </div>
            {loading === 'openai' && (
              <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin flex-shrink-0" />
            )}
            {currentProvider === 'openai' && loading !== 'openai' && (
              <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
          </button>

          {/* Anthropic */}
          <button
            onClick={() => handleSelect('anthropic')}
            disabled={loading !== null}
            className={`w-full py-4 rounded-xl border transition-all duration-150 flex items-center gap-4 px-5 disabled:opacity-50 ${
              loading === 'anthropic'
                ? 'bg-[#f25f4c]/10 border-[#f25f4c]/60'
                : currentProvider === 'anthropic'
                  ? 'bg-[#f25f4c]/10 border-[#f25f4c]/40'
                  : 'bg-white/5 border-glass-border hover:border-[#f25f4c]/40 hover:bg-white/[0.08]'
            }`}
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#f25f4c] to-[#ff8700] flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <div className="text-base font-black text-text">Anthropic</div>
              <div className="text-sm text-text-muted/70 font-medium">claude-sonnet-4-6</div>
              <div className="text-xs text-text-muted/50 mt-0.5">Anthropic Messages API</div>
            </div>
            {loading === 'anthropic' && (
              <div className="w-5 h-5 border-2 border-[#f25f4c]/30 border-t-[#f25f4c] rounded-full animate-spin flex-shrink-0" />
            )}
            {currentProvider === 'anthropic' && loading !== 'anthropic' && (
              <div className="w-5 h-5 rounded-full bg-[#f25f4c] flex items-center justify-center flex-shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
          </button>
        </div>

        {/* Footer: switch provider link */}
        <div className="text-center">
          <button
            onClick={onClose}
            className="text-xs text-text-muted/60 hover:text-text-muted transition-colors cursor-pointer"
          >
            切换到其他服务商 →
          </button>
        </div>
      </div>
    </div>
  )
}
