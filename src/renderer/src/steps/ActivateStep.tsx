import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../components/Button'

// ─── Types ───────────────────────────────────────────────────────────────────
interface ActivateData {
  accountId: string
  email: string
  apiKey: string
  baseUrl: string
  apiFormat?: string
}

// baseUrl for installer API endpoints — always points to clawlite.ai
const INSTALLER_BASE = 'https://clawlite.ai/api'

// ─── Step: Email Input ────────────────────────────────────────────────────────
function EmailStep({
  onSendCode,
  loading,
  error
}: {
  onSendCode: (email: string) => Promise<void>
  loading: boolean
  error: string | null
}): React.JSX.Element {
  const { t } = useTranslation('activation')
  const [email, setEmail] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [inputActive, setInputActive] = useState(false)
  const [isSending, setIsSending] = useState(false)

  const isValidEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

  const handleSend = async (): Promise<void> => {
    if (!isValidEmail(email)) {
      setLocalError(t('email.invalid'))
      return
    }
    setLocalError(null)
    setIsSending(true)
    try {
      await onSendCode(email)
    } finally {
      setIsSending(false)
    }
  }

  const displayError = localError || error

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-sm mx-auto">
      {/* Logo / Icon */}
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
            stroke="var(--color-primary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="text-center">
        <h2 className="text-xl font-black tracking-tight">{t('email.title')}</h2>
        <p className="text-text-muted text-sm mt-1">{t('email.subtitle')}</p>
      </div>

      <div className="w-full space-y-3">
        <div>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setLocalError(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            onFocus={() => setInputActive(true)}
            onBlur={() => setInputActive(false)}
            placeholder={t('email.placeholder')}
            autoFocus
            disabled={loading}
            className={`w-full px-4 py-3 rounded-xl bg-white/5 border text-sm text-text placeholder:text-text-muted/40 transition-all duration-200 disabled:opacity-50 ${
              displayError
                ? 'border-error/60 focus:border-error/80 focus:bg-error/5'
                : inputActive
                ? 'border-primary/60 focus:border-primary/80 bg-white/[0.07]'
                : 'border-glass-border focus:border-primary/60 focus:bg-white/[0.07]'
            }`}
          />
          {displayError && (
            <p className="mt-1.5 text-xs text-error font-medium pl-1">{displayError}</p>
          )}
        </div>

        <Button
          type="button"
          variant="primary"
          size="lg"
          disabled={!isValidEmail(email) || isSending}
          onClick={handleSend}
          className="w-full font-black text-[15px] shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/50 hover:brightness-110 active:scale-[0.97] transition-all duration-150"
        >
          {isSending ? (t('email.sending') || 'Sending...') : t('email.sendCode')}
        </Button>
      </div>
    </div>
  )
}

// ─── Step: Verify Code ────────────────────────────────────────────────────────
function VerifyStep({
  email,
  onBack,
  onResend,
  onVerify,
  loading,
  error,
  cooldownSecs
}: {
  email: string
  onBack: () => void
  onResend: () => void
  onVerify: (code: string) => Promise<void>
  loading: boolean
  error: string | null
  cooldownSecs: number
}): React.JSX.Element {
  const { t } = useTranslation('activation')
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const inputsRef = useRef<(HTMLInputElement | null)[]>([])

  // Auto-submit when all 6 digits are filled
  useEffect(() => {
    if (code.every((c) => c.length === 1)) {
      onVerify(code.join(''))
    }
  }, [code, onVerify])

  const handleChange = (index: number, value: string): void => {
    if (!/^\d?$/.test(value)) return
    const next = [...code]
    next[index] = value
    setCode(next)
    if (value && index < 5) {
      inputsRef.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent): void => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputsRef.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent): void => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length === 0) return
    e.preventDefault()
    const next = [...code]
    for (let i = 0; i < 6; i++) {
      next[i] = pasted[i] || ''
    }
    setCode(next)
    const lastFilled = Math.min(pasted.length - 1, 5)
    inputsRef.current[lastFilled]?.focus()
  }

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-sm mx-auto">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <rect
            x="3"
            y="11"
            width="18"
            height="11"
            rx="2"
            ry="2"
            stroke="var(--color-primary)"
            strokeWidth="2"
          />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="var(--color-primary)" strokeWidth="2" />
        </svg>
      </div>

      <div className="text-center">
        <h2 className="text-xl font-black tracking-tight">{t('verify.title')}</h2>
        <p className="text-text-muted text-sm mt-1">{t('verify.subtitle', { email })}</p>
      </div>

      {/* 6-digit inputs */}
      <div className="flex gap-2" onPaste={handlePaste}>
        {code.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { inputsRef.current[i] = el }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            disabled={loading}
            autoFocus={i === 0}
            className="w-11 h-13 text-center text-xl font-black rounded-xl bg-white/5 border border-glass-border text-text placeholder:text-text-muted/30 focus:outline-none focus:border-primary/70 focus:bg-white/[0.07] transition-all duration-200 disabled:opacity-50"
          />
        ))}
      </div>

      {error && (
        <p className="text-xs text-error font-medium text-center bg-error/10 px-3 py-2 rounded-xl border border-error/20">
          {error}
        </p>
      )}

      {loading && (
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="text-xs text-text-muted/60">{t('verify.verifying')}</p>
        </div>
      )}

      {/* Manual verify button - appears when code is complete */}
      {!loading && code.every((c) => c.length === 1) && (
        <button
          onClick={() => onVerify(code.join(''))}
          className="w-full py-3 rounded-xl bg-primary text-white font-black text-[15px] shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/50 hover:brightness-110 active:scale-[0.97] transition-all duration-150"
        >
          Verify Code
        </button>
      )}

      <div className="w-full flex items-center justify-between text-xs text-text-muted/60">
        <button
          onClick={onBack}
          className="text-xs text-text-muted/60 hover:text-text font-medium transition-colors cursor-pointer px-2 py-1 rounded-lg hover:bg-white/10"
        >
          {t('verify.changeEmail')}
        </button>

        {cooldownSecs > 0 ? (
          <span>{t('verify.resendCooldown', { secs: cooldownSecs })}</span>
        ) : (
          <button
            onClick={onResend}
            className="text-primary hover:text-primary-light font-semibold transition-colors cursor-pointer"
          >
            {t('verify.resend')}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Step: Topup ─────────────────────────────────────────────────────────────
function TopupStep({
  onBack,
  onCheckout,
  loading,
  error,
}: {
  onBack: () => void
  onCheckout: (amount: number) => Promise<void>
  loading: boolean
  error: string | null
}): React.JSX.Element {
  const { t } = useTranslation('activation')

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-sm mx-auto">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 border border-amber-500/20 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#f59e0b" strokeWidth="2" />
          <path d="M12 6v6l4 2" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      <div className="text-center">
        <h2 className="text-xl font-black tracking-tight">{t('topup.title')}</h2>
        <p className="text-text-muted text-sm mt-1">{t('topup.subtitle')}</p>
      </div>

      <div className="w-full space-y-3">
        {[5, 10, 20].map((amount) => (
          <button
            key={amount}
            onClick={() => onCheckout(amount)}
            disabled={loading}
            className="w-full py-4 rounded-xl bg-white/5 border border-glass-border hover:border-primary/60 hover:bg-white/[0.08] active:scale-[0.98] transition-all duration-150 disabled:opacity-50 flex items-center justify-between px-5"
          >
            <span className="text-lg font-black text-text">${amount}</span>
            <span className="text-xs text-text-muted/60 font-medium">{t('topup.addFunds')}</span>
          </button>
        ))}
      </div>

      {error && (
        <p className="text-xs text-error font-medium text-center bg-error/10 px-3 py-2 rounded-xl border border-error/20">
          {error}
        </p>
      )}

      <button
        onClick={onBack}
        className="text-xs text-text-muted/60 hover:text-text font-medium transition-colors cursor-pointer px-2 py-1 rounded-lg hover:bg-white/10"
      >
        {t('topup.back')}
      </button>
    </div>
  )
}

// ─── Step: Model Select ───────────────────────────────────────────────────────
function ModelSelectStep({
  email,
  onSelect,
  onBack,
}: {
  email: string
  onSelect: (config: ActivateData) => Promise<void>
  onBack: () => void
}): React.JSX.Element {
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<'gpt' | 'anthropic' | null>(null)

  const handleConfirm = async (): Promise<void> => {
    if (!selected) return
    setLoading(true)
    try {
      // Load verify-otp response data from sessionStorage to get apiKey
      const stored = sessionStorage.getItem('activate_verify_data')
      const verifyData = stored ? JSON.parse(stored) : {}
      const apiKey = verifyData.apiKey || ''

      let config: ActivateData
      if (selected === 'gpt') {
        config = {
          accountId: verifyData.accountId || '',
          email,
          apiKey,
          baseUrl: 'https://clawlite.ai/api/openai/v1',
        }
      } else {
        config = {
          accountId: verifyData.accountId || '',
          email,
          apiKey,
          baseUrl: 'https://clawlite.ai/api/claude',
          apiFormat: 'anthropic-messages',
        }
      }
      await onSelect(config)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-sm mx-auto">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
            stroke="var(--color-primary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="text-center">
        <h2 className="text-xl font-black tracking-tight">选择模型</h2>
        <p className="text-text-muted text-sm mt-1">选择要使用的 AI 模型 Provider</p>
      </div>

      <div className="w-full space-y-3">
        {/* GPT Option */}
        <button
          onClick={() => setSelected('gpt')}
          className={`w-full py-4 rounded-xl border transition-all duration-150 flex items-center gap-4 px-5 ${
            selected === 'gpt'
              ? 'bg-primary/10 border-primary/60 shadow-lg shadow-primary/20'
              : 'bg-white/5 border-glass-border hover:border-primary/40 hover:bg-white/[0.08]'
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.9485 4.9485 0 0 1-2.8766-1.0408 4.8684 4.8684 0 0 1-1.8589-2.0826 4.9854 4.9854 0 0 1-.5829-3.6327 4.9854 4.9854 0 0 1 .5829-3.6327 4.8684 4.8684 0 0 1 1.8589-2.0826 4.9485 4.9485 0 0 1 4.0827-.297 4.981 4.981 0 0 1 3.875 2.7637 4.9863 4.9863 0 0 1 .582 3.9516 4.9854 4.9854 0 0 1-.582 3.6327 4.8684 4.8684 0 0 1-1.8589 2.0826 4.9485 4.9485 0 0 1-4.0827.297z"/>
            </svg>
          </div>
          <div className="flex-1 text-left">
            <div className="text-base font-black text-text">GPT</div>
            <div className="text-sm text-text-muted/70 font-medium">gpt-5.4</div>
            <div className="text-xs text-text-muted/50 mt-0.5">OpenAI 兼容 API</div>
          </div>
          {selected === 'gpt' && (
            <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          )}
        </button>

        {/* Anthropic Option */}
        <button
          onClick={() => setSelected('anthropic')}
          className={`w-full py-4 rounded-xl border transition-all duration-150 flex items-center gap-4 px-5 ${
            selected === 'anthropic'
              ? 'bg-[#f25f4c]/10 border-[#f25f4c]/60 shadow-lg shadow-[#f25f4c]/20'
              : 'bg-white/5 border-glass-border hover:border-[#f25f4c]/40 hover:bg-white/[0.08]'
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#f25f4c] to-[#ff8700] flex items-center justify-center flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div className="flex-1 text-left">
            <div className="text-base font-black text-text">Anthropic</div>
            <div className="text-sm text-text-muted/70 font-medium">claude-opus-4-7</div>
            <div className="text-xs text-text-muted/50 mt-0.5">Anthropic Messages API</div>
          </div>
          {selected === 'anthropic' && (
            <div className="w-5 h-5 rounded-full bg-[#f25f4c] flex items-center justify-center flex-shrink-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          )}
        </button>
      </div>

      <button
        onClick={handleConfirm}
        disabled={!selected || loading}
        className="w-full py-3.5 rounded-xl bg-primary text-white font-black text-[15px] shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/50 hover:brightness-110 active:scale-[0.97] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? '保存中...' : '确认并继续'}
      </button>

      <button
        onClick={onBack}
        className="text-xs text-text-muted/60 hover:text-text font-medium transition-colors cursor-pointer px-2 py-1 rounded-lg hover:bg-white/10"
      >
        返回
      </button>
    </div>
  )
}

// ─── Step: Pending Topup (Stripe Checkout Polling) ─────────────────────────────
function PendingTopupStep({
  accountId,
  onCancel,
  onComplete,
}: {
  accountId: string
  onCancel: () => void
  onComplete: () => void
}): React.JSX.Element {
  const { t } = useTranslation('activation')
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startPolling = useCallback(async (): Promise<void> => {
    const poll = async (): Promise<void> => {
      try {
        const resp = await fetch(`${INSTALLER_BASE}/installer/topup/check-status?accountId=${encodeURIComponent(accountId)}`)
        const data = await resp.json()
        if (data.isActive) {
          if (pollingRef.current) clearInterval(pollingRef.current)
          onComplete()
          return
        }
      } catch {
        // keep polling
      }
    }
    pollingRef.current = setInterval(poll, 3000)
    // initial check
    poll()
  }, [accountId, onComplete])

  useEffect(() => {
    startPolling()
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [startPolling])

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-sm mx-auto">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 border border-amber-500/20 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
      </div>

      <div className="text-center">
        <h2 className="text-xl font-black tracking-tight">{t('pendingTopup.title')}</h2>
        <p className="text-text-muted text-sm mt-1">{t('pendingTopup.subtitle')}</p>
      </div>

      <button
        onClick={onCancel}
        className="text-xs text-text-muted/60 hover:text-text font-medium transition-colors cursor-pointer px-2 py-1 rounded-lg hover:bg-white/10"
      >
        {t('pendingTopup.cancel')}
      </button>
    </div>
  )
}

// ─── Main ActivateStep ────────────────────────────────────────────────────────
type View = 'checking' | 'email' | 'verify' | 'model_select' | 'topup' | 'pending_topup' | 'error'

interface Props {
  onNext: () => void
}

export default function ActivateStep({ onNext }: Props): React.JSX.Element {
  const { t } = useTranslation('activation')
  const [view, setView] = useState<View>('checking')
  const [email, setEmail] = useState('')
  const [topupAccountId, setTopupAccountId] = useState('')
  const [topupApiKey, setTopupApiKey] = useState('')
  const [topupBaseUrl, setTopupBaseUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [cooldownSecs, setCooldownSecs] = useState(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cooldown timer
  useEffect(() => {
    if (cooldownSecs > 0) {
      cooldownRef.current = setInterval(() => {
        setCooldownSecs((c) => Math.max(0, c - 1))
      }, 1000)
    } else if (cooldownRef.current) {
      clearInterval(cooldownRef.current)
      cooldownRef.current = null
    }
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current)
    }
  }, [cooldownSecs > 0])

  // On mount: check for existing activation
  useEffect(() => {
    const checkExisting = async (): Promise<void> => {
      try {
        const result = await window.electronAPI.installer.loadActivate()
        if (result && result.apiKey && result.baseUrl) {
          // Already activated — skip to telegramGuide
          onNext()
          return
        }
        setView('email')
      } catch {
        setView('email')
      }
    }
    checkExisting()
  }, [onNext])

  const handleSendCode = useCallback(
    async (inputEmail: string): Promise<void> => {
      setEmail(inputEmail)
      setError(null)
      setCooldownSecs(60)
      setLoading(true)
      try {
        const resp = await fetch(`${INSTALLER_BASE}/installer/auth/send-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: inputEmail })
        })
        const data = await resp.json()
        if (!resp.ok) {
          setError(data.error || 'Failed to send code')
          setCooldownSecs(0)
          return
        }
        setView('verify')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error')
        setCooldownSecs(0)
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const handleVerify = useCallback(
    async (code: string): Promise<void> => {
      setError(null)
      setLoading(true)
      try {
        const resp = await fetch(`${INSTALLER_BASE}/installer/auth/verify-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code })
        })
        const data = await resp.json()
        if (!resp.ok) {
          setError(data.error || 'Invalid code')
          setLoading(false)
          return
        }

        const accountId = data.accountId || ''
        const isActive = data.isActive === true
        const balance = (data as any).balance ?? 0

        // If account is active and has balance, go to model select
        if (isActive && balance > 0) {
          // Store verify data for model select to retrieve apiKey
          sessionStorage.setItem('activate_verify_data', JSON.stringify({
            accountId,
            apiKey: data.apiKey,
            baseUrl: (data as any).baseUrl || 'https://clawlite.ai/api/openai/v1'
          }))
          setView('model_select')
          setLoading(false)
          return
        }

        // Otherwise redirect to topup — preserve apiKey and baseUrl from verify-otp response
        setTopupAccountId(accountId)
        setTopupApiKey(data.apiKey || '')
        setTopupBaseUrl((data as any).baseUrl || 'https://clawlite.ai/api/openai/v1')
        setView('topup')
        setLoading(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Verification failed')
        setLoading(false)
      }
    },
    [email, onNext]
  )

  const handleResend = useCallback(async (): Promise<void> => {
    if (cooldownSecs > 0) return
    await handleSendCode(email)
  }, [cooldownSecs, email, handleSendCode])

  const handleBack = (): void => {
    setView('email')
    setEmail('')
    setError(null)
    // Reset topup state so a fresh verify-otp flow starts clean
    setTopupAccountId('')
    setTopupApiKey('')
    setTopupBaseUrl('')
  }

  const handleTopupCheckout = useCallback(
    async (amount: number): Promise<void> => {
      setError(null)
      setLoading(true)
      try {
        const resp = await fetch(`${INSTALLER_BASE}/installer/topup/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: topupAccountId, email, amount })
        })
        const data = await resp.json()
        if (!resp.ok || !data.checkoutUrl) {
          setError(data.error || 'Failed to start checkout')
          setLoading(false)
          return
        }
        // Open Stripe checkout in browser
        window.electronAPI.system.openExternal(data.checkoutUrl)
        setView('pending_topup')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Checkout failed')
        setLoading(false)
      }
    },
    [topupAccountId, email]
  )

  const handleModelSelect = useCallback(
    async (config: ActivateData): Promise<void> => {
      try {
        await window.electronAPI.installer.saveActivate(config)
      } catch {
        // best effort
      }
      sessionStorage.removeItem('activate_verify_data')
      onNext()
    },
    [onNext]
  )

  const handleModelSelectBack = useCallback((): void => {
    sessionStorage.removeItem('activate_verify_data')
    setView('email')
    setEmail('')
  }, [])

  const handleTopupComplete = useCallback(async (): Promise<void> => {
    const saveData: ActivateData = {
      accountId: topupAccountId,
      email,
      apiKey: topupApiKey,
      baseUrl: topupBaseUrl
    }
    try {
      await window.electronAPI.installer.saveActivate(saveData)
    } catch {
      // best effort
    }
    onNext()
  }, [topupAccountId, email, topupApiKey, topupBaseUrl, onNext])

  if (view === 'checking') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 px-8">
      <div className="flex-1 flex flex-col items-center justify-center pb-8">
        {view === 'email' && (
          <EmailStep
            onSendCode={handleSendCode}
            loading={loading}
            error={error}
          />
        )}
        {view === 'verify' && (
          <VerifyStep
            email={email}
            onBack={handleBack}
            onResend={handleResend}
            onVerify={handleVerify}
            loading={loading}
            error={error}
            cooldownSecs={cooldownSecs}
          />
        )}
        {view === 'topup' && (
          <TopupStep
            onBack={handleBack}
            onCheckout={handleTopupCheckout}
            loading={loading}
            error={error}
          />
        )}
        {view === 'model_select' && (
          <ModelSelectStep
            email={email}
            onSelect={handleModelSelect}
            onBack={handleModelSelectBack}
          />
        )}
        {view === 'pending_topup' && (
          <PendingTopupStep
            accountId={topupAccountId}
            onCancel={handleBack}
            onComplete={handleTopupComplete}
          />
        )}
        {view === 'error' && (
          <div className="flex flex-col items-center gap-4 max-w-sm mx-auto text-center">
            <p className="text-error text-sm font-medium">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => setView('email')}>
              {t('verify.changeEmail')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
