import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import StepIndicator from './components/StepIndicator'
import UpdateBanner from './components/UpdateBanner'
import ActivationModal from './components/ActivationModal'
import { useWizard } from './hooks/useWizard'
import { useActivation } from './hooks/useActivation'
import WelcomeStep from './steps/WelcomeStep'
import EnvCheckStep from './steps/EnvCheckStep'
import WslSetupStep from './steps/WslSetupStep'
import InstallStep from './steps/InstallStep'
import ApiKeyGuideStep from './steps/ApiKeyGuideStep'
import TelegramGuideStep from './steps/TelegramGuideStep'
import ConfigStep from './steps/ConfigStep'
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
  // Track activation status to detect email-verified flow that skips provider selection
  const { status: activationStatus } = useActivation()

  const [installNeeds, setInstallNeeds] = useState<InstallNeeds>({
    needNode: false,
    needOpenclaw: false
  })
  const [provider, setProvider] = useState<'anthropic' | 'google' | 'openai' | 'minimax' | 'glm'>(
    'anthropic'
  )
  const [modelId, setModelId] = useState<string | undefined>()
  const [authMethod, setAuthMethod] = useState<'api-key' | 'oauth'>('api-key')
  const [botUsername, setBotUsername] = useState<string | undefined>()
  const [isWindows, setIsWindows] = useState(false)
  const [wslState, setWslState] = useState<WslState>('ready')
  const [version, setVersion] = useState('')

  // ─── Activation gate ──────────────────────────────────────────────────────────
  const [activationChecked, setActivationChecked] = useState(false)
  const [showActivation, setShowActivation] = useState(false)

  const checkActivationOnMount = useCallback(async (): Promise<void> => {
    // Get installer instance ID (same one used by useActivation for bootstrap)
    const instanceId = (() => {
      try {
        let id = localStorage.getItem('clawlite_installer_instance_id')
        if (!id) {
          id = crypto.randomUUID()
          localStorage.setItem('clawlite_installer_instance_id', id)
        }
        return id
      } catch {
        return undefined
      }
    })()

    try {
      const result = await window.electronAPI.activation.check(instanceId)
      if (result.activated) {
        setShowActivation(false)
      } else {
        setShowActivation(true)
      }
    } catch {
      // Network/server error → treat as unactivated, show modal
      setShowActivation(true)
    } finally {
      setActivationChecked(true)
    }
  }, [])

  useEffect(() => {
    checkActivationOnMount()
  }, [checkActivationOnMount])

  const handleActivationSuccess = useCallback((skipProvider: boolean = false): void => {
    setShowActivation(false)
    if (skipProvider) {
      // After email verification, skip "Choose Provider" (apiKeyGuide) and go to Telegram config
      goTo('telegramGuide')
    }
  }, [goTo])

  // Load version + OS check + reboot restoration on app start
  useEffect(() => {
    if (!activationChecked) return
    window.electronAPI.version().then(setVersion)

    // Run loadState() after env.check() completes (prevent race condition)
    window.electronAPI.env.check().then(async (env) => {
      setIsWindows(env.os === 'windows')
      if (env.wslState) setWslState(env.wslState)

      // Restore state after reboot — run after wslState is correctly set
      const state = await window.electronAPI.wizard.loadState()
      if (state) {
        goTo(state.step as 'wslSetup' | 'envCheck')
      }
    })
  }, [activationChecked, goTo])

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

  const handleDone = useCallback(
    (username?: string): void => {
      setBotUsername(username)
      window.electronAPI.wizard.clearState()
      goTo('done')
    },
    [goTo]
  )

  // Show spinner while checking activation
  if (!activationChecked) {
    return (
      <div className="aurora-bg" />
    )
  }

  return (
    <>
      {/* ─── Activation Modal (shown when not activated) ─── */}
      {showActivation && (
        <ActivationModal
          onLaunchClawLite={() => handleActivationSuccess(false)}
          onComplete={handleActivationSuccess}
          onClose={undefined}
        />
      )}

      <div className="aurora-bg" />
      <div className="grain-overlay" />
      <Bubbles />

      <div className="flex flex-col h-full relative z-10">
        {currentStep !== 'welcome' && currentStep !== 'troubleshoot' && (
          <StepIndicator
            currentStep={currentStep}
            isWindows={isWindows}
            wizardSteps={
              activationStatus === 'need_skip_provider'
                ? isWindows
                  ? ['welcome', 'envCheck', 'wslSetup', 'install', 'telegramGuide', 'config', 'done']
                  : ['welcome', 'envCheck', 'install', 'telegramGuide', 'config', 'done']
                : undefined
            }
          />
        )}

        <div className="flex-1 flex flex-col min-h-0 pb-10 step-enter" key={currentStep}>
          {currentStep === 'welcome' && <WelcomeStep onNext={next} />}
          {currentStep === 'envCheck' && (
            <EnvCheckStep onNext={() => goTo('apiKeyGuide')} onNeedInstall={handleEnvCheckDone} />
          )}
          {currentStep === 'wslSetup' && (
            <WslSetupStep wslState={wslState} onReady={handleWslReady} />
          )}
          {currentStep === 'install' && (
            <InstallStep needs={installNeeds} onDone={() => goTo('apiKeyGuide')} />
          )}
          {currentStep === 'apiKeyGuide' && (
            <ApiKeyGuideStep
              provider={provider}
              onSelectProvider={(p) => {
                setProvider(p)
                setModelId(undefined)
                setAuthMethod('api-key')
              }}
              authMethod={authMethod}
              onSelectAuthMethod={setAuthMethod}
              modelId={modelId}
              onSelectModel={setModelId}
              onNext={next}
            />
          )}
          {currentStep === 'telegramGuide' && <TelegramGuideStep onNext={next} />}
          {currentStep === 'config' && (
            <ConfigStep
              provider={provider}
              authMethod={authMethod}
              modelId={modelId}
              onDone={handleDone}
            />
          )}
          {currentStep === 'done' && (
            <DoneStep
              botUsername={botUsername}
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
