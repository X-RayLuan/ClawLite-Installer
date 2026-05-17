import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import LobsterLogo from '../components/LobsterLogo'
import Button from '../components/Button'
import LogViewer from '../components/LogViewer'
import ProviderSwitchModal from '../components/ProviderSwitchModal'
import ModelSelectModal from '../components/ModelSelectModal'
import { useInstallLogs } from '../hooks/useIpc'

type Provider = 'anthropic' | 'google' | 'openai' | 'minimax' | 'glm'

const providerPatterns: Record<Provider, RegExp> = {
  anthropic: /^sk-ant-/,
  google: /^AIza/,
  openai: /^sk-(?!ant-)/,
  minimax: /^sk-/,
  glm: /^.{8,}$/
}

const providerPlaceholders: Record<Provider, string> = {
  anthropic: 'sk-ant-...',
  google: 'AIza...',
  openai: 'sk-...',
  minimax: 'sk-...',
  glm: 'API Key'
}

const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]+$/

interface Props {
  provider: Provider
  authMethod?: 'api-key' | 'oauth'
  modelId?: string
  onDone: (botUsername?: string) => void
}

export default function ConfigStep({
  provider,
  authMethod,
  modelId,
  onDone
}: Props): React.JSX.Element {
  const { t } = useTranslation(['steps', 'common'])
  const { t: tp } = useTranslation('providers')
  const [apiKey, setApiKey] = useState('')
  const [botToken, setBotToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [oauthDone, setOauthDone] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const { logs, clearLogs } = useInstallLogs()
  const isOAuth = authMethod === 'oauth'

  // ─── Model & Channel Choose state ───
  const [showModelSelect, setShowModelSelect] = useState(false)
  const [currentModel, setCurrentModel] = useState<string | null>(null)
  const [currentProvider, setCurrentProvider] = useState<string | undefined>()
  const [showProviderModal, setShowProviderModal] = useState(false)
  const [showChannelChoose, setShowChannelChoose] = useState(false)
  const [channelSaving, setChannelSaving] = useState(false)
  const [larkSetup, setLarkSetup] = useState<{
    phase: 'idle' | 'qr' | 'polling' | 'installing' | 'success' | 'error'
    qrUrl?: string
    oauthUrl?: string
    message?: string
    installLogs?: string
  }>({ phase: 'idle' })
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)

  // Load current model/provider on mount
  useEffect(() => {
    window.electronAPI.config.read().then((cfg) => {
      if (cfg) {
        setCurrentModel(cfg.config?.model || null)
        setCurrentProvider(cfg.config?.provider || undefined)
      }
    })
  }, [])

  // Generate QR code on canvas when larkSetup.qrUrl changes
  useEffect(() => {
    if (!larkSetup.qrUrl || !qrCanvasRef.current) return
    if (larkSetup.phase !== 'qr' && larkSetup.phase !== 'polling' && larkSetup.phase !== 'error') return
    const canvas = qrCanvasRef.current
    QRCode.toCanvas(canvas, larkSetup.qrUrl, {
      margin: 1,
      width: 180
    }).catch(() => {})
  }, [larkSetup.qrUrl, larkSetup.phase])

  const pattern = providerPatterns[provider]
  const label = t(`config.apiKeyLabel.${provider}`)
  const placeholder = tp(`apiKeyPlaceholder.${provider}`, providerPlaceholders[provider])
  const apiKeyValid = pattern.test(apiKey)
  const botTokenValid = botToken ? BOT_TOKEN_PATTERN.test(botToken) : true
  const canSave = isOAuth ? oauthDone && !saving : apiKeyValid && !saving

  const handleOAuthLogin = async (): Promise<void> => {
    setOauthLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.oauth.loginCodex()
      if (result.success) {
        setOauthDone(true)
      } else {
        setError(
          result.error === 'cancelled'
            ? t('config.oauthCancelled')
            : result.error || t('config.oauthError')
        )
      }
    } catch {
      setError(t('config.oauthError'))
    } finally {
      setOauthLoading(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    clearLogs()
    try {
      const result = await window.electronAPI.onboard.run({
        provider,
        ...(isOAuth ? {} : { apiKey }),
        authMethod: authMethod ?? 'api-key',
        telegramBotToken: botToken || undefined,
        modelId
      })
      if (result.success) {
        onDone(result.botUsername)
      } else {
        setError(result.error ?? t('config.errorOccurred'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common:error.unknown'))
    } finally {
      setSaving(false)
    }
  }

  const configureLarkBot = useCallback(async (domain: 'feishu' | 'lark' = 'feishu'): Promise<void> => {
    if (channelSaving) return
    const brandName = domain === 'lark' ? 'Lark' : 'Feishu'
    setChannelSaving(true)
    setShowChannelChoose(false)

    // ─── Phase 1: Begin Feishu scan-to-create registration ───
    setLarkSetup({ phase: 'qr', message: `Starting ${brandName} scan-to-create...` })

    let beginResult: Awaited<ReturnType<typeof window.electronAPI.channel.larkBeginRegistration>>
    try {
      beginResult = await window.electronAPI.channel.larkBeginRegistration(domain)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLarkSetup({ phase: 'error', message: msg })
      setChannelSaving(false)
      return
    }

    if (!beginResult.success || !beginResult.qrUrl || !beginResult.deviceCode) {
      const msg = beginResult.error || `${brandName} registration begin failed`
      setLarkSetup({ phase: 'error', message: msg })
      setChannelSaving(false)
      return
    }

    // Show QR from qrUrl returned by the API
    setLarkSetup({
      phase: 'qr',
      qrUrl: beginResult.qrUrl,
      message: `Scan the QR code with your ${brandName} mobile app to authorize the bot.`
    })

    // ─── Phase 2: Poll for scan completion via API ───
    setLarkSetup((prev) => ({ ...prev, phase: 'polling', message: `Waiting for ${brandName} authorization...` }))

    const completeResult = await window.electronAPI.channel.larkCompleteRegistration({
      deviceCode: beginResult.deviceCode,
      interval: beginResult.interval,
      expireIn: beginResult.expireIn
    })
    if (!completeResult.success) {
      const msg = completeResult.error || completeResult.status || `Authorization timed out or failed`
      setLarkSetup({ phase: 'error', message: msg })
      setChannelSaving(false)
      return
    }

    // ─── Phase 3: Install @openclaw/feishu plugin ───
    setLarkSetup({ phase: 'installing', message: 'Scan complete! Installing @openclaw/feishu plugin...' })

    const installResult = await window.electronAPI.channel.larkInstallPlugin(domain)
    if (!installResult.success) {
      const msg = `Plugin install failed: ${installResult.status}`
      setLarkSetup({ phase: 'error', message: msg, installLogs: installResult.logs })
      setChannelSaving(false)
      return
    }

    // All three phases succeeded
    setLarkSetup({ phase: 'success', message: `${brandName} setup complete! Plugin installed and enabled.` })
    setChannelSaving(false)
  }, [channelSaving])

  return (
    <div className="flex-1 flex flex-col min-h-0 px-8 pt-6">
      <div className="flex-1 overflow-y-auto pb-2 space-y-4">
        <div className="flex items-center gap-3">
          <LobsterLogo state={saving ? 'loading' : 'idle'} size={48} />
          <div>
            <h2 className="text-lg font-extrabold">{t('config.title')}</h2>
            <p className="text-text-muted text-xs">{t('config.desc')}</p>
          </div>
        </div>

        {isOAuth ? (
          <div className="space-y-1.5">
            <label className="text-sm font-bold">OpenAI {t('apiKeyGuide.authMethod.oauth')}</label>
            {oauthDone ? (
              <div className="flex items-center gap-2 px-4 py-2.5 bg-success/10 border border-success/30 rounded-xl">
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
                <span className="text-sm font-medium text-success">{t('config.oauthSuccess')}</span>
              </div>
            ) : (
              <button
                onClick={handleOAuthLogin}
                disabled={oauthLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/15 border border-glass-border rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer disabled:opacity-50"
              >
                {oauthLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
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
                    {t('config.oauthLoggingIn')}
                  </>
                ) : (
                  t('config.oauthLogin')
                )}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-sm font-bold">
              {label} <span className="text-error text-xs">{t('config.required')}</span>
            </label>
            <input
              type="password"
              placeholder={placeholder}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={`w-full bg-bg-input rounded-xl px-4 py-2.5 text-sm font-mono outline-none border transition-all duration-200 placeholder:text-text-muted/30 ${
                apiKey && !apiKeyValid
                  ? 'border-error/50 focus:border-error'
                  : 'border-glass-border focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-glow)]'
              }`}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-bold">{t('config.telegramToken')} <span className="text-text-muted text-xs">(optional)</span></label>
          <input
            type="text"
            placeholder="123456:ABCDEF..."
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            className={`w-full bg-bg-input rounded-xl px-4 py-2.5 text-sm font-mono outline-none border transition-all duration-200 placeholder:text-text-muted/30 ${
              botToken && !botTokenValid
                ? 'border-error/50 focus:border-error'
                : 'border-glass-border focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-glow)]'
            }`}
          />
          {botToken && !botTokenValid && (
            <p className="text-error text-[11px] font-medium">{t('config.telegramHint')}</p>
          )}
        </div>

        {logs.length > 0 && <LogViewer lines={logs} />}
        {error && <p className="text-error text-xs font-medium">{error}</p>}
      </div>

      {/* ─── Model & Channel Choose settings ─── */}
      <div className="shrink-0 border-t border-glass-border pt-3 mt-2 space-y-2">
        <p className="text-xs font-bold text-text-muted/60 px-1">Additional Settings</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setShowModelSelect(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-glass-border hover:border-primary/40 hover:bg-white/8 transition-all duration-200 cursor-pointer"
          >
            <span className="text-sm">🤖</span>
            <div className="flex-1 text-left min-w-0">
              <span className="text-[11px] font-bold truncate block">Model Choose</span>
              {currentModel && (
                <span className="text-[10px] text-text-muted/60 truncate block">{currentModel}</span>
              )}
            </div>
          </button>
          <button
            onClick={() => setShowChannelChoose(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-glass-border hover:border-primary/40 hover:bg-white/8 transition-all duration-200 cursor-pointer"
          >
            <span className="text-sm">💬</span>
            <div className="flex-1 text-left min-w-0">
              <span className="text-[11px] font-bold truncate block">Channel Choose</span>
              <span className="text-[10px] text-text-muted/60 truncate block">Lark / Feishu</span>
            </div>
          </button>
        </div>
      </div>

      {/* ─── Action footer ─── */}
      <div className="shrink-0 flex justify-end py-3">
        <Button
          variant="primary"
          size="lg"
          onClick={handleSave}
          disabled={!canSave}
          loading={saving}
        >
          {saving ? t('config.savingBtn') : t('config.saveBtn')}
        </Button>
      </div>

      {/* ─── Model select modal ─── */}
      {showModelSelect && (
        <ModelSelectModal
          currentModelId={currentModel || undefined}
          onClose={() => setShowModelSelect(false)}
          onSuccess={() => {
            window.electronAPI.config.read().then((cfg) => {
              if (cfg) {
                setCurrentModel(cfg.config?.model || null)
                setCurrentProvider(cfg.config?.provider || undefined)
              }
            })
            setShowModelSelect(false)
          }}
        />
      )}

      {/* ─── Provider switch modal ─── */}
      {showProviderModal && (
        <ProviderSwitchModal
          currentProvider={currentProvider}
          currentModel={currentModel || undefined}
          onClose={() => setShowProviderModal(false)}
          onSuccess={() => {
            window.electronAPI.config.read().then((cfg) => {
              if (cfg) {
                setCurrentModel(cfg.config?.model || null)
                setCurrentProvider(cfg.config?.provider || undefined)
              }
            })
            setShowProviderModal(false)
          }}
        />
      )}

      {/* ─── Channel Choose modal ─── */}
      {showChannelChoose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4 rounded-2xl border border-glass-border bg-[#1a1a2e] p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">Choose Channel</h3>
              <button
                onClick={() => setShowChannelChoose(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-white/10 transition-all"
              >
                ✕
              </button>
            </div>
            <p className="text-[12px] text-text-muted/70 mb-4">Select a messaging platform to create and bind your bot.</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => configureLarkBot('lark')}
                disabled={channelSaving || larkSetup.phase === 'polling'}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-glass-border bg-white/5 hover:bg-white/10 hover:border-primary/40 cursor-pointer transition-all duration-200 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0" fill="#1475E7">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.22l-2.477 10.65c-.127.47-.455.79-.877.79H9.46c-.422 0-.75-.32-.877-.79L6.106 8.22a.94.94 0 0 1 .877-1.28h10.034c.522 0 .922.516.877 1.28z" />
                </svg>
                <div className="flex-1 text-left">
                  <span className="text-sm font-bold">Lark</span>
                  <p className="text-[11px] text-text-muted/60">字节跳动 Lark（海外版）</p>
                </div>
                <span className="text-text-muted text-sm">›</span>
              </button>
              <button
                onClick={() => configureLarkBot('feishu')}
                disabled={channelSaving || larkSetup.phase === 'polling'}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-glass-border bg-white/5 hover:bg-white/10 hover:border-primary/40 cursor-pointer transition-all duration-200 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0" fill="#1677FF">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.22l-2.477 10.65c-.127.47-.455.79-.877.79H9.46c-.422 0-.75-.32-.877-.79L6.106 8.22a.94.94 0 0 1 .877-1.28h10.034c.522 0 .922.516.877 1.28z" />
                </svg>
                <div className="flex-1 text-left">
                  <span className="text-sm font-bold">Feishu</span>
                  <p className="text-[11px] text-text-muted/60">飞书（字节跳动·国内版）</p>
                </div>
                <span className="text-text-muted text-sm">›</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Lark setup status ─── */}
      {(larkSetup.phase === 'qr' || larkSetup.phase === 'polling') && larkSetup.qrUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4 rounded-2xl border border-glass-border bg-[#1a1a2e] p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">{larkSetup.phase === 'qr' ? 'Scan QR Code' : 'Waiting...'}</h3>
            </div>
            <div className="text-center">
              <canvas ref={qrCanvasRef} className="mx-auto h-[180px] w-[180px] rounded-lg bg-white p-2" />
              <p className="mt-3 text-[12px] text-text-muted/70">
                {larkSetup.message || 'Scan with Lark/Feishu mobile app to authorize.'}
              </p>
              {larkSetup.oauthUrl && (
                <button
                  onClick={() => window.electronAPI.system.openExternal(larkSetup.oauthUrl!)}
                  className="mt-2 text-[11px] text-primary/90 hover:text-primary"
                >
                  Open authorization page
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {larkSetup.phase === 'installing' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4 rounded-2xl border border-warning/30 bg-[#1a1a2e] p-5 shadow-2xl">
            <p className="text-center text-sm text-warning">
              {larkSetup.message || 'Installing plugin...'}
            </p>
            {larkSetup.installLogs && (
              <pre className="mt-2 text-[10px] text-warning/70 whitespace-pre-wrap">{larkSetup.installLogs}</pre>
            )}
          </div>
        </div>
      )}

      {larkSetup.phase === 'success' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4 rounded-2xl border border-success/30 bg-[#1a1a2e] p-5 shadow-2xl">
            <p className="text-center text-sm text-success font-bold">✓ {larkSetup.message}</p>
            <button
              onClick={() => setLarkSetup({ phase: 'idle' })}
              className="mt-3 w-full py-2 rounded-xl bg-success/20 text-success text-sm font-semibold cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {larkSetup.phase === 'error' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4 rounded-2xl border border-error/30 bg-[#1a1a2e] p-5 shadow-2xl">
            <p className="text-center text-sm text-error font-bold">✕ {larkSetup.message}</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setLarkSetup({ phase: 'idle' })}
                className="flex-1 py-2 rounded-xl bg-white/10 text-sm cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => setShowChannelChoose(true)}
                className="flex-1 py-2 rounded-xl bg-error/20 text-error text-sm font-semibold cursor-pointer"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
