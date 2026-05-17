import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import LobsterLogo from '../components/LobsterLogo'
import ModelSelectModal from '../components/ModelSelectModal'
import Button from '../components/Button'

interface Props {
  onNext: () => void
  onBack: () => void
}

export default function ModelConfigStep({ onNext, onBack }: Props): React.JSX.Element {
  const { t } = useTranslation('steps')
  const [currentModelId, setCurrentModelId] = useState<string | undefined>()
  const [showModal, setShowModal] = useState(false)
  const [saved, setSaved] = useState(false)
  // no-op: saving is handled inside modal

  // Load current model on mount
  useEffect(() => {
    window.electronAPI.config.read().then((r) => {
      if (r.success && r.config?.model) {
        setCurrentModelId(r.config.model)
      }
    })
  }, [])

  return (
    <div className="flex-1 flex flex-col min-h-0 px-8 pt-6">
      <div className="flex-1 overflow-y-auto pb-2">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <LobsterLogo state={saved ? 'loading' : saved ? 'success' : 'idle'} size={48} />
          <div>
            <h2 className="text-lg font-extrabold">{t('modelConfig.title')}</h2>
            <p className="text-text-muted text-xs">{t('modelConfig.desc')}</p>
          </div>
        </div>

        {/* Current selection display */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/5 border border-glass-border">
            <div className="flex items-center gap-3">
              <span className="text-lg">🤖</span>
              <div>
                <p className="text-xs font-bold text-text-muted">{t('modelConfig.current')}</p>
                <p className="text-sm font-bold text-text">{currentModelId || t('modelConfig.notSet')}</p>
              </div>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-xs font-bold hover:bg-primary/30 transition-all cursor-pointer"
            >
              {t('modelConfig.change')}
            </button>
          </div>
        </div>

        {/* Saved state */}
        {saved && (
          <div className="mt-4 flex items-center gap-2 px-4 py-2.5 bg-success/10 border border-success/30 rounded-xl">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-success"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-sm font-medium text-success">{t('modelConfig.saved')}</span>
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
          disabled={!currentModelId && !saved}
        >
          {t('modelConfig.saveBtn')}
        </Button>
      </div>

      {/* Model select modal */}
      {showModal && (
        <ModelSelectModal
          currentModelId={currentModelId}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            window.electronAPI.config.read().then((r) => {
              if (r.success && r.config?.model) {
                setCurrentModelId(r.config.model)
              }
            })
            setSaved(true)
            setShowModal(false)
          }}
        />
      )}
    </div>
  )
}