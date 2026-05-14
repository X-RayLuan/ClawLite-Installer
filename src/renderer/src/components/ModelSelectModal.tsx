import { useState } from 'react'

type ModelChoice = 'gpt' | 'opus'

interface Props {
  currentModelId?: string   // e.g. 'clawlite/gpt-5.4' or 'clawlite/claude-opus-4-7'
  onClose: () => void
  onSuccess: () => void
}

export default function ModelSelectModal({
  currentModelId,
  onClose,
  onSuccess
}: Props): React.JSX.Element {
  const [loading, setLoading] = useState<ModelChoice | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Determine which is currently active based on model id prefix
  const current: ModelChoice | null =
    currentModelId?.includes('claude') ? 'opus' : currentModelId?.includes('gpt') ? 'gpt' : null

  const handleSelect = async (choice: ModelChoice): Promise<void> => {
    if (choice === current) {
      onClose()
      return
    }
    setLoading(choice)
    setError(null)
    try {
      const result = await window.electronAPI.model.switch(choice)
      if (result.success) {
        onSuccess()
        onClose()
      } else {
        setError(result.error || '切换失败')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '切换失败')
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
            <h3 className="text-base font-black">Model Choose</h3>
            <p className="text-xs text-text-muted mt-0.5">选择模型后 Gateway 将自动重启</p>
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
          {/* GPT */}
          <button
            onClick={() => handleSelect('gpt')}
            disabled={loading !== null}
            className={`w-full py-4 rounded-xl border transition-all duration-150 flex items-center gap-4 px-5 disabled:opacity-50 ${
              loading === 'gpt'
                ? 'bg-primary/10 border-primary/60'
                : current === 'gpt'
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
              <div className="text-sm text-text-muted/70 font-medium">gpt-5.4</div>
              <div className="text-xs text-text-muted/50 mt-0.5">clawlite.ai / OpenAI 兼容</div>
            </div>
            {loading === 'gpt' && (
              <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin flex-shrink-0" />
            )}
            {current === 'gpt' && loading !== 'gpt' && (
              <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
          </button>

          {/* Claude Opus */}
          <button
            onClick={() => handleSelect('opus')}
            disabled={loading !== null}
            className={`w-full py-4 rounded-xl border transition-all duration-150 flex items-center gap-4 px-5 disabled:opacity-50 ${
              loading === 'opus'
                ? 'bg-[#f25f4c]/10 border-[#f25f4c]/60'
                : current === 'opus'
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
              <div className="text-base font-black text-text">Claude Opus</div>
              <div className="text-sm text-text-muted/70 font-medium">claude-opus-4-7</div>
              <div className="text-xs text-text-muted/50 mt-0.5">clawlite.ai / Anthropic Messages</div>
            </div>
            {loading === 'opus' && (
              <div className="w-5 h-5 border-2 border-[#f25f4c]/30 border-t-[#f25f4c] rounded-full animate-spin flex-shrink-0" />
            )}
            {current === 'opus' && loading !== 'opus' && (
              <div className="w-5 h-5 rounded-full bg-[#f25f4c] flex items-center justify-center flex-shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
