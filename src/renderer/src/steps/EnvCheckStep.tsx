import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import LobsterLogo from '../components/LobsterLogo'
import Button from '../components/Button'

type WslState =
  | 'not_available'
  | 'not_installed'
  | 'needs_reboot'
  | 'no_distro'
  | 'not_initialized'
  | 'ready'

interface EnvResult {
  os: 'macos' | 'windows' | 'linux'
  nodeInstalled: boolean
  nodeVersion: string | null
  nodeVersionOk: boolean
  openclawInstalled: boolean
  openclawVersion: string | null
  openclawLatestVersion: string | null
  wslState?: WslState
}

const CheckRow = ({
  label,
  ok,
  detail
}: {
  label: string
  ok: boolean
  detail: string
}): React.JSX.Element => (
  <div className="glass-card flex items-center justify-between px-4 py-3">
    <span className="text-sm font-semibold">{label}</span>
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono text-text-muted">{detail}</span>
      <div
        className={`w-2 h-2 rounded-full ${ok ? 'bg-success' : 'bg-error'}`}
        style={ok ? { animation: 'glow-pulse 2s infinite', color: 'var(--color-success)' } : {}}
      />
    </div>
  </div>
)

export default function EnvCheckStep({
  onNext,
  onNeedInstall
}: {
  onNext: () => void
  onNeedInstall: (env: EnvResult) => void
}): React.JSX.Element {
  const { t } = useTranslation(['steps', 'common'])
  const [checking, setChecking] = useState(true)
  const [env, setEnv] = useState<EnvResult | null>(null)


  const wslStateLabel = (state?: WslState): string => {
    switch (state) {
      case 'ready':
        return t('envCheck.wslState.ready')
      case 'no_distro':
        return t('envCheck.wslState.noDistro')
      case 'needs_reboot':
        return t('envCheck.wslState.needsReboot')
      case 'not_installed':
        return t('envCheck.wslState.notInstalled')
      case 'not_initialized':
        return t('envCheck.wslState.notInitialized')
      case 'not_available':
        return t('envCheck.wslState.notAvailable')
      default:
        return t('envCheck.wslState.checking')
    }
  }

  const runCheck = (): void => {
    setChecking(true)
    window.electronAPI.env
      .check()
      .then((result) => setEnv(result as EnvResult))
      .catch(() => setEnv(null))
      .finally(() => setChecking(false))
  }

  useEffect(() => {
    runCheck()
  }, [])





  const allReady = env ? env.nodeInstalled && env.nodeVersionOk && env.openclawInstalled : false

  const handleContinue = (): void => {
    if (!env) return
    allReady ? onNext() : onNeedInstall(env)
  }

  return (
    <div className="flex-1 flex flex-col items-center pt-16 px-8 gap-5">
      <LobsterLogo state={checking ? 'loading' : allReady ? 'success' : 'idle'} size={72} />

      <h2 className="text-lg font-extrabold">{t('envCheck.title')}</h2>

      {checking ? (
        <p className="text-text-muted text-sm animate-pulse">{t('envCheck.scanning')}</p>
      ) : env ? (
        <div className="w-full max-w-xs space-y-2.5">
          <CheckRow
            label={t('envCheck.os')}
            ok={true}
            detail={env.os === 'macos' ? 'macOS' : env.os === 'windows' ? 'Windows' : 'Linux'}
          />
          {env.os === 'windows' && (
            <CheckRow
              label={t('envCheck.wsl')}
              ok={env.wslState === 'ready'}
              detail={wslStateLabel(env.wslState)}
            />
          )}
          <CheckRow
            label={t('envCheck.nodejs')}
            ok={env.nodeVersionOk}
            detail={env.nodeInstalled ? `v${env.nodeVersion}` : t('common:status.notInstalled')}
          />
          <CheckRow
            label={t('envCheck.openclaw')}
            ok={env.openclawInstalled}
            detail={
              env.openclawInstalled ? `v${env.openclawVersion}` : t('common:status.notInstalled')
            }
          />

        </div>
      ) : null}

      <Button
        variant="primary"
        size="lg"
        onClick={handleContinue}
        disabled={checking}
        loading={checking}
      >
        {checking
          ? t('envCheck.checkBtn')
          : allReady
            ? t('envCheck.nextBtn')
            : t('envCheck.installBtn')}
      </Button>
    </div>
  )
}
