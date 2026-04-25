import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from './Button'
import { useActivation, type LicenseType } from '../hooks/useActivation'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function maskApiKey(key: string): string {
  if (key.length <= 8) return '*'.repeat(key.length)
  return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4)
}

function formatExpiry(licenseType: LicenseType, expiresAt: string | null): string {
  if (licenseType === 'lifetime') return 'Never'
  if (!expiresAt) return '—'
  const d = new Date(expiresAt)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function licenseLabel(type: LicenseType): string {
  switch (type) {
    case 'annual':
      return 'Annual'
    case 'lifetime':
      return 'Lifetime'
    case 'trial':
      return 'Trial'
    default:
      return '—'
  }
}

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

  const isValidEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

  const handleSend = async (): Promise<void> => {
    if (!isValidEmail(email)) {
      setLocalError(t('email.invalid'))
      return
    }
    setLocalError(null)
    await onSendCode(email)
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
            placeholder={t('email.placeholder')}
            autoFocus
            disabled={loading}
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-glass-border text-sm text-text placeholder:text-text-muted/40 focus:outline-none focus:border-primary/60 focus:bg-white/[0.07] transition-all duration-200 disabled:opacity-50"
          />
          {displayError && (
            <p className="mt-1.5 text-xs text-error font-medium pl-1">{displayError}</p>
          )}
        </div>

        <Button
          variant="primary"
          size="lg"
          loading={loading}
          disabled={!isValidEmail(email) || loading}
          onClick={handleSend}
          className="w-full"
        >
          {t('email.sendCode')}
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
        <p className="text-text-muted text-sm mt-1">
          {t('verify.subtitle', { email })}
        </p>
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

      {error && <p className="text-xs text-error font-medium text-center">{error}</p>}

      {loading && (
        <p className="text-xs text-text-muted/60">{t('verify.verifying')}</p>
      )}

      <div className="w-full flex items-center justify-between text-xs text-text-muted/60">
        <button
          onClick={onBack}
          className="hover:text-text transition-colors cursor-pointer"
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

// ─── Step: Topup Selection ────────────────────────────────────────────────────
function TopupStep({
  onBack,
  onSelectAmount
}: {
  onBack: () => void
  onSelectAmount: (amount: 5 | 10 | 20) => void
}): React.JSX.Element {
  const { t } = useTranslation('activation')

  const amounts = [
    { amount: 5 as const, label: t('topup.amount5') },
    { amount: 10 as const, label: t('topup.amount10') },
    { amount: 20 as const, label: t('topup.amount20') }
  ]

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-sm mx-auto">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-success/20 to-success/5 border border-success/20 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"
            stroke="var(--color-success)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="text-center">
        <h2 className="text-xl font-black tracking-tight">{t('topup.title')}</h2>
        <p className="text-text-muted text-sm mt-1">{t('topup.subtitle')}</p>
      </div>

      <div className="w-full flex flex-col gap-3">
        {amounts.map(({ amount, label }) => (
          <button
            key={amount}
            onClick={() => onSelectAmount(amount)}
            className="w-full flex items-center justify-between px-5 py-4 rounded-2xl bg-white/5 border border-glass-border hover:border-primary/50 hover:bg-primary/10 transition-all duration-200 cursor-pointer group"
          >
            <span className="text-base font-black">{label}</span>
            <span className="text-xs text-text-muted/60 group-hover:text-primary">
              {t('topup.credits')}
            </span>
          </button>
        ))}
      </div>

      <button
        onClick={onBack}
        className="text-xs text-text-muted/60 hover:text-text-muted transition-colors cursor-pointer"
      >
        {t('topup.back')}
      </button>
    </div>
  )
}

// ─── Step: Pending Topup (polling) ────────────────────────────────────────────
function PendingTopupStep({
  onCancel
}: {
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation('activation')

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-sm mx-auto">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="animate-spin" style={{ animationDuration: '2s' }}>
          <circle cx="12" cy="12" r="10" stroke="var(--color-primary)" strokeWidth="2" strokeDasharray="30 60" strokeLinecap="round" />
        </svg>
      </div>

      <div className="text-center">
        <h2 className="text-xl font-black tracking-tight">{t('pendingTopup.title')}</h2>
        <p className="text-text-muted text-sm mt-1">{t('pendingTopup.subtitle')}</p>
      </div>

      <p className="text-center text-xs text-text-muted/60 px-4">
        {t('pendingTopup.hint')}
      </p>

      <p className="text-center text-xs text-text-muted/40">
        {t('pendingTopup.checking')}
      </p>

      <button
        onClick={onCancel}
        className="text-xs text-text-muted/60 hover:text-text-muted transition-colors cursor-pointer"
      >
        {t('pendingTopup.cancel')}
      </button>
    </div>
  )
}

// ─── Step: Activated ─────────────────────────────────────────────────────────
function ActivatedStep({
  info,
  onLogout,
  onLaunch,
  loading
}: {
  info: {
    email: string
    licenseType: LicenseType
    expiresAt: string | null
    apiKey: string
  }
  onLogout: () => void
  onLaunch: () => void
  loading: boolean
}): React.JSX.Element {
  const { t } = useTranslation('activation')
  const [copied, setCopied] = useState(false)

  const handleCopy = (): void => {
    navigator.clipboard.writeText(info.apiKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const expiry = formatExpiry(info.licenseType, info.expiresAt)
  const maskedKey = maskApiKey(info.apiKey)

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-sm mx-auto">
      {/* Success icon */}
      <div className="relative">
        <div className="absolute inset-0 bg-success/10 rounded-full blur-2xl scale-125" />
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-success/20 to-success/5 border border-success/20 flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path
              d="M22 11.08V12a10 10 0 1 1-5.93-9.14"
              stroke="var(--color-success)"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <polyline
              points="22 4 12 14.01 9 11.01"
              stroke="var(--color-success)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      <div className="text-center">
        <h2 className="text-xl font-black tracking-tight">{t('activated.title')}</h2>
        <p className="text-text-muted text-sm mt-1">{t('activated.subtitle')}</p>
      </div>

      {/* Account info card */}
      <div className="w-full rounded-2xl bg-white/5 border border-glass-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted/60">{t('activated.email')}</span>
          <span className="text-sm font-semibold truncate max-w-[180px]" title={info.email}>
            {info.email}
          </span>
        </div>
        <div className="h-px bg-glass-border" />
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted/60">{t('activated.license')}</span>
          <span className="text-sm font-semibold text-primary">{licenseLabel(info.licenseType)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted/60">{t('activated.expires')}</span>
          <span className="text-sm font-semibold">{expiry}</span>
        </div>
        <div className="h-px bg-glass-border" />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-text-muted/60">{t('activated.apiKey')}</span>
          <div className="flex items-center gap-1.5">
            <code className="text-xs font-mono text-text-muted/80">{maskedKey}</code>
            <button
              onClick={handleCopy}
              className="p-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
              title={t('activated.copyKey')}
            >
              {copied ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <polyline points="20 6 9 17 4 12" stroke="var(--color-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="w-full flex flex-col gap-2.5">
        <Button
          variant="primary"
          size="lg"
          onClick={onLaunch}
          className="w-full"
        >
          {t('activated.launch')}
        </Button>
        <button
          onClick={onLogout}
          disabled={loading}
          className="w-full py-2.5 text-sm font-semibold text-text-muted/60 hover:text-text-muted transition-colors cursor-pointer disabled:opacity-40"
        >
          {t('activated.logout')}
        </button>
      </div>
    </div>
  )
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export type ActivationView = 'email' | 'verify' | 'topup' | 'pending_topup' | 'activated'

interface ActivationModalProps {
  onClose?: () => void
  onLaunchClawLite: () => void
}

export default function ActivationModal({
  onClose,
  onLaunchClawLite
}: ActivationModalProps): React.JSX.Element {
  const { t } = useTranslation('activation')
  const {
    status,
    activationInfo,
    error,
    sendCode,
    verifyCode,
    checkActivation,
    startTopup,
    cancelTopup,
    logout
  } = useActivation()

  // Map hook status → modal view
  const [view, setView] = useState<ActivationView>('email')
  const [email, setEmail] = useState('')
  const [cooldownSecs, setCooldownSecs] = useState(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sync view with hook status
  useEffect(() => {
    switch (status) {
      case 'idle':
      case 'need_verify':
        setView('email')
        break
      case 'checking':
        // stay on current view while checking
        break
      case 'need_topup':
        setView('topup')
        break
      case 'pending_topup':
        setView('pending_topup')
        break
      case 'activated':
        setView('activated')
        break
      case 'error':
        // stay on current view — error message shown inline
        break
    }
  }, [status])

  // On mount: check activation status
  useEffect(() => {
    checkActivation()
  }, [checkActivation])

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

  const handleSendCode = useCallback(
    async (inputEmail: string): Promise<void> => {
      const ok = await sendCode(inputEmail)
      if (ok) {
        setEmail(inputEmail)
        setView('verify')
        setCooldownSecs(60)
      }
    },
    [sendCode]
  )

  const handleVerify = useCallback(
    async (code: string): Promise<void> => {
      await verifyCode(email, code)
    },
    [email, verifyCode]
  )

  const handleResend = useCallback(async (): Promise<void> => {
    if (cooldownSecs > 0) return
    await handleSendCode(email)
  }, [cooldownSecs, email, handleSendCode])

  const handleSelectAmount = useCallback(
    async (amount: 5 | 10 | 20): Promise<void> => {
      await startTopup(amount)
    },
    [startTopup]
  )

  const handleLogout = useCallback(async (): Promise<void> => {
    await logout()
    setView('email')
    setEmail('')
    onClose?.()
  }, [logout, onClose])

  const handleLaunch = (): void => {
    onLaunchClawLite()
    onClose?.()
  }

  const isLoading = status === 'checking'

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-md pointer-events-auto">
          <div className="relative rounded-3xl bg-bg-card backdrop-blur-2xl border border-glass-border shadow-2xl shadow-black/50 overflow-hidden">
            {/* Header strip */}
            <div className="h-1 bg-gradient-to-r from-primary via-primary-light to-primary" />

            {/* Close button (only when already activated) */}
            {view === 'activated' && onClose && (
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </button>
            )}

            <div className="px-8 py-8">
              {view === 'email' && (
                <EmailStep
                  onSendCode={handleSendCode}
                  loading={isLoading}
                  error={status === 'error' ? error : null}
                />
              )}
              {view === 'verify' && (
                <VerifyStep
                  email={email}
                  onBack={() => setView('email')}
                  onResend={handleResend}
                  onVerify={handleVerify}
                  loading={isLoading}
                  error={status === 'error' ? error : null}
                  cooldownSecs={cooldownSecs}
                />
              )}
              {view === 'topup' && (
                <TopupStep
                  onBack={() => setView('email')}
                  onSelectAmount={handleSelectAmount}
                />
              )}
              {view === 'pending_topup' && (
                <PendingTopupStep onCancel={cancelTopup} />
              )}
              {view === 'activated' && activationInfo && (
                <ActivatedStep
                  info={activationInfo}
                  onLogout={handleLogout}
                  onLaunch={handleLaunch}
                  loading={isLoading}
                />
              )}
            </div>

            {/* Footer */}
            {view !== 'activated' && (
              <div className="px-8 pb-5 flex items-center justify-center gap-1 text-[10px] text-text-muted/40">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="2" />
                </svg>
                {t('footer.secure')}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
