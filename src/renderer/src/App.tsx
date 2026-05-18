import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import StepIndicator from './components/StepIndicator'
import UpdateBanner from './components/UpdateBanner'
import { useWizard } from './hooks/useWizard'
import WelcomeStep from './steps/WelcomeStep'
import EnvCheckStep from './steps/EnvCheckStep'
import WslSetupStep from './steps/WslSetupStep'
import InstallStep from './steps/InstallStep'
import ActivateStep from './steps/ActivateStep'
import ModelConfigStep from './steps/ModelConfigStep'
import ChannelConfigStep from './steps/ChannelConfigStep'
import DoneStep from './steps/DoneStep'
import TroubleshootStep from './steps/TroubleshootStep'

type WslState =
  | 'not_available'
  | 'not_installed'
  | 'needs_reboot'
  | 'no_distro'
  | 'not_initialized'
  | 'ready'

interface InstallNeeds {
  needNode: boolean
  needOpenclaw: boolean
}

const BUBBLES = Array.from({ length: 8 }, (_, i) => ({
  id: i,
  size: 6 + Math.random() * 18,
  left: Math.random() * 100,
  delay: Math.random() * 10,
  duration: 14 + Math.random() * 12
}))

const Bubbles = (): React.JSX.Element => {
  const bubbles = BUBBLES

  return (
    <>
      {bubbles.map((b) => (
        <div
          key={b.id}
          className="bubble"
          style={{
            width: b.size,
            height: b.size,
            left: `${b.left}%`,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.duration}s`
          }}
        />
      ))}
    </>
  )
}

function App(): React.JSX.Element {
  const { t } = useTranslation('common')
  const { currentStep, next, prev, canGoBack, goTo } = useWizard()

  const [installNeeds, setInstallNeeds] = useState<InstallNeeds>({
    needNode: false,
    needOpenclaw: false
  })
  const [isWindows, setIsWindows] = useState(false)
  const [wslState, setWslState] = useState<WslState>('ready')
  const [version, setVersion] = useState('')

  // Load version + OS check on app start
  useEffect(() => {
    window.electronAPI.version().then(setVersion)
    window.electronAPI.env.check().then(async (env) => {
      setIsWindows(env.os === 'windows')
      if (env.wslState) setWslState(env.wslState)
    })
  }, [])

  const handleEnvCheckDone = (env: {
    os: string
    nodeVersionOk: boolean
    openclawInstalled: boolean
    wslState?: WslState
  }): void => {
    setInstallNeeds({
      needNode: !env.nodeVersionOk,
      needOpenclaw: !env.openclawInstalled
    })

    // Windows + WSL not ready → navigate to wslSetup
    if (env.os === 'windows' && env.wslState && env.wslState !== 'ready') {
      setWslState(env.wslState)
      goTo('wslSetup')
      return
    }

    goTo('install')
  }

  const handleWslReady = useCallback((): void => {
    // WSL ready → clear state file and re-run envCheck
    window.electronAPI.wizard.clearState()
    goTo('envCheck')
  }, [goTo])

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="aurora-bg" />
      <div className="grain-overlay" />
      <Bubbles />

      <div className="flex flex-col h-full w-full relative z-10">
        {currentStep !== 'welcome' && currentStep !== 'troubleshoot' && (
          <StepIndicator
            currentStep={currentStep}
            isWindows={isWindows}
          />
        )}

        <div className="flex-1 flex flex-col min-h-0 pb-10 step-enter w-full" key={currentStep}>
          {currentStep === 'welcome' && <WelcomeStep onNext={next} />}
          {currentStep === 'envCheck' && (
            <EnvCheckStep onNext={() => goTo('install')} onNeedInstall={handleEnvCheckDone} />
          )}
          {currentStep === 'wslSetup' && (
            <WslSetupStep wslState={wslState} onReady={handleWslReady} />
          )}
          {currentStep === 'install' && (
            <InstallStep
              needs={installNeeds}
              onDone={() => goTo('activate')}
              onActivationCheck={() => goTo('activate')}
            />
          )}
          {currentStep === 'activate' && (
            <ActivateStep onNext={() => goTo('modelConfig')} />
          )}
          {currentStep === 'modelConfig' && (
            <ModelConfigStep />
          )}
          {currentStep === 'channelConfig' && (
            <ChannelConfigStep
              onNext={() => goTo('done')}
            />
          )}
          {currentStep === 'done' && (
            <DoneStep
              onTroubleshoot={() => goTo('troubleshoot')}
              onUninstallDone={() => {
                window.electronAPI.wizard.clearState()
                goTo('welcome')
              }}
            />
          )}
          {currentStep === 'troubleshoot' && (
            <TroubleshootStep isWindows={isWindows} onBack={prev} />
          )}
        </div>

        <div className="absolute bottom-3 right-4 flex items-center gap-2">
          {import.meta.env.DEV && currentStep !== 'done' && (
            <button
              onClick={() => goTo('done')}
              className="text-[10px] text-text-muted/40 hover:text-primary/60 font-mono transition-colors"
            >
              [skip→done]
            </button>
          )}
          {version && (
            <span className="text-[10px] text-text-muted/30 font-medium select-none">
              {version}
            </span>
          )}
        </div>

        <UpdateBanner />

        {canGoBack && currentStep !== 'troubleshoot' && (
          <button
            onClick={prev}
            className="absolute bottom-14 left-6 z-20 flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-text-muted hover:text-text bg-white/5 hover:bg-white/10 rounded-xl border border-glass-border transition-all duration-200"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            {t('button.back')}
          </button>
        )}
      </div>
    </>
  )
}

export default App
