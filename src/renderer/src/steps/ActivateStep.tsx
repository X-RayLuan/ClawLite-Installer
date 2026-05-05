import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../components/Button'

// ─── Types ───────────────────────────────────────────────────────────────────
interface ActivateData {
  accountId: string
  email: string
  apiKey: string
  baseUrl: string
}

const BASE_URL = 'https://clawlite.ai/api'

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

// ─── Main ActivateStep ────────────────────────────────────────────────────────
type View = 'checking' | 'email' | 'verify' | 'error'

interface Props {
  onNext: () => void
}

export default function ActivateStep({ onNext }: Props): React.JSX.Element {
  const { t } = useTranslation('activation')
  const [view, setView] = useState<View>('checking')
  const [email, setEmail] = useState('')
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
        const resp = await fetch(`${BASE_URL}/installer/auth/send-otp`, {
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
        const resp = await fetch(`${BASE_URL}/installer/auth/verify-otp`, {
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

        // Save to activate.json AND openclaw.json
        const saveData: ActivateData = {
          accountId: data.accountId || '',
          email,
          apiKey: data.apiKey,
          baseUrl: data.baseUrl
        }
        await window.electronAPI.installer.saveActivate(saveData)
        onNext()
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
  }

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
