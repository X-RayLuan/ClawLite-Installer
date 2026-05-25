import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import StepIndicator from './components/StepIndicator'
import UpdateBanner from './components/UpdateBanner'
import { useWizard } from './hooks/useWizard'
import WelcomeStep from './steps/WelcomeStep'
import EnvCheckStep from './steps/EnvCheckStep'
import InstallStep from './steps/InstallStep'
import ActivateStep from './steps/ActivateStep'
import ModelConfigStep from './steps/ModelConfigStep'
import ChannelConfigStep from './steps/ChannelConfigStep'
import DoneStep from './steps/DoneStep'
import ConfigModal from './components/ConfigModal'
import TroubleshootStep from './steps/TroubleshootStep'



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
  const [installType] = useState<'native'>('native')
  const [version, setVersion] = useState('')
  const [showConfigModal, setShowConfigModal] = useState(false)

  // Load version + OS check on app start
  useEffect(() => {
    window.electronAPI.version().then(setVersion)
    window.electronAPI.env.check().then(() => {})
  }, [])

  const handleEnvCheckDone = (env: {
    os: string
    nodeVersionOk: boolean
    openclawInstalled: boolean
  }): void => {
    setInstallNeeds({
      needNode: !env.nodeVersionOk,
      needOpenclaw: !env.openclawInstalled
    })

    // Windows needs install → go directly to install (only native mode now)
    if (env.os === 'windows' && (!env.nodeVersionOk || !env.openclawInstalled)) {
      goTo('install')
      return
    }

    goTo('install')
  }

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
          />
        )}

        <div className="flex-1 flex flex-col min-h-0 pb-10 step-enter w-full" key={currentStep}>
          <div className="w-full max-w-3xl mx-auto">
            {currentStep === 'welcome' && <WelcomeStep onNext={next} />}
            {currentStep === 'envCheck' && (
              <EnvCheckStep onNext={() => goTo('install')} onNeedInstall={handleEnvCheckDone} />
            )}

            {currentStep === 'install' && (
              <InstallStep
                needs={installNeeds}
                installType={installType}
                onDone={() => goTo('activate')}
                onActivationCheck={() => goTo('activate')}
              />
            )}
            {currentStep === 'activate' && (
              <ActivateStep onNext={() => goTo('modelConfig')} />
            )}
            {currentStep === 'modelConfig' && (
              <ModelConfigStep onNext={() => goTo('channelConfig')} />
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
                onConfig={() => setShowConfigModal(true)}
              />
            )}
            {showConfigModal && (
              <ConfigModal
                onClose={() => setShowConfigModal(false)}
                onDone={() => setShowConfigModal(false)}
              />
            )}
            {currentStep === 'troubleshoot' && (
              <TroubleshootStep isWindows={true} onBack={prev} />
            )}
          </div>
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
