import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import LobsterLogo from '../components/LobsterLogo'
import Button from '../components/Button'

export type InstallType = 'wsl' | 'native'

interface InstallTypeStepProps {
  onSelect: (type: InstallType) => void
}

export default function InstallTypeStep({ onSelect }: InstallTypeStepProps): React.JSX.Element {
  const { t } = useTranslation('steps')
  const [selected, setSelected] = useState<InstallType>('native')

  return (
    <div className="flex-1 flex flex-col items-center pt-16 px-8 gap-5">
      <LobsterLogo state="idle" size={72} />

      <h2 className="text-lg font-extrabold">{t('installType.title')}</h2>
      <p className="text-text-muted text-sm text-center max-w-xs">
        {t('installType.subtitle')}
      </p>

      <div className="w-full max-w-xs space-y-3 mt-2">
        <button
          className={`w-full glass-card p-4 text-left rounded-xl border-2 transition-all ${
            selected === 'native'
              ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
              : 'border-transparent hover:border-[var(--color-primary)]/30'
          }`}
          onClick={() => setSelected('native')}
        >
          <div className="flex items-center gap-3">
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
              selected === 'native' ? 'border-[var(--color-primary)]' : 'border-[var(--color-text-muted)]'
            }`}>
              {selected === 'native' && (
                <div className="w-2 h-2 rounded-full bg-[var(--color-primary)]" />
              )}
            </div>
            <div>
              <div className="text-sm font-semibold">{t('installType.native.title')}</div>
              <div className="text-xs text-text-muted">{t('installType.native.desc')}</div>
            </div>
          </div>
        </button>

        <button
          className={`w-full glass-card p-4 text-left rounded-xl border-2 transition-all ${
            selected === 'wsl'
              ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
              : 'border-transparent hover:border-[var(--color-primary)]/30'
          }`}
          onClick={() => setSelected('wsl')}
        >
          <div className="flex items-center gap-3">
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
              selected === 'wsl' ? 'border-[var(--color-primary)]' : 'border-[var(--color-text-muted)]'
            }`}>
              {selected === 'wsl' && (
                <div className="w-2 h-2 rounded-full bg-[var(--color-primary)]" />
              )}
            </div>
            <div>
              <div className="text-sm font-semibold">{t('installType.wsl.title')}</div>
              <div className="text-xs text-text-muted">{t('installType.wsl.desc')}</div>
            </div>
          </div>
        </button>
      </div>

      <Button
        variant="primary"
        size="lg"
        onClick={() => onSelect(selected)}
      >
        {t('installType.next')}
      </Button>
    </div>
  )
}
