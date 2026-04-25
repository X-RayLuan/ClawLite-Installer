import { useState, useCallback, useRef, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivationStatus =
  | 'idle'
  | 'checking'
  | 'need_login'
  | 'need_purchase'
  | 'pending_redirect'
  | 'activated'
  | 'error'

export type LicenseType = 'annual' | 'lifetime' | 'trial' | 'unknown'

export interface ActivationInfo {
  email: string
  licenseType: LicenseType
  expiresAt: string | null // ISO date string, null for lifetime
  apiKey: string
}

const API_BASE = 'http://localhost:3000/api'

// ─── Installer Instance ID ───────────────────────────────────────────────────

function getInstallerInstanceId(): string {
  const key = 'clawlite_installer_instance_id'
  try {
    let id = localStorage.getItem(key)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(key, id)
    }
    return id
  } catch {
    // localStorage unavailable (e.g. test env) — use a transient ID
    return crypto.randomUUID()
  }
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // ensure cookies are sent/received
    ...options
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// OTP send response
interface OtpSendResponse {
  ok: boolean
  error?: string
}

// OTP verify response
interface OtpVerifyResponse {
  ok: boolean
  verified?: boolean
  email?: string
  redirectUrl?: string
  error?: string
}

// Bootstrap response (PRD v1.1)
interface BootstrapResponse {
  setupToken: string
  entitlement: {
    status: 'active' | 'inactive'
  }
  allowedPaths: Array<'connect_now' | 'buy_and_connect' | 'use_own_key'>
  recommendedPath: 'connect_now' | 'buy_and_connect' | 'use_own_key'
  accountId?: string // present when user is logged in
}

// Provision response (PRD v1.1)
interface ProvisionResponse {
  provisioningState: 'bound' | 'unbound'
  credentialRef: string // API Key — only returned once
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useActivation() {
  const [status, setStatus] = useState<ActivationStatus>('idle')
  const [activationInfo, setActivationInfo] = useState<ActivationInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Tracks the email being verified (used after redirect returns)
  const pendingEmailRef = useRef<string | null>(null)

  // After opening magiclink, listen for window focus to re-check bootstrap
  useEffect(() => {
    if (status !== 'pending_redirect') return

    const handleFocus = (): void => {
      const email = pendingEmailRef.current
      if (email) {
        pendingEmailRef.current = null
        // Re-check bootstrap — this time accountId should be present
        checkBootstrap(email).catch(() => {
          // If still fails, return to login
          setStatus('need_login')
        })
      }
    }

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [status])

  /**
   * Bootstrap + optional provision.
   * Called on mount and after magiclink redirect returns.
   */
  const checkBootstrap = useCallback(
    async (email?: string): Promise<void> => {
      setStatus('checking')
      setError(null)
      try {
        const instanceId = getInstallerInstanceId()
        const params: { installerInstanceId: string; accountId?: string; platform?: string } = {
          installerInstanceId: instanceId,
          platform: 'installer'
        }
        if (email) params.accountId = email

        const data = await apiFetch<BootstrapResponse>('/installer/activation/bootstrap', {
          method: 'POST',
          body: JSON.stringify(params)
        })

        if (data.entitlement.status === 'active') {
          // Already entitled — call provision to get the API key
          const provisionData = await apiFetch<ProvisionResponse>(
            '/installer/activation/provision',
            {
              method: 'POST',
              body: JSON.stringify({
                setupToken: data.setupToken,
                accountId: data.accountId
              })
            }
          )
          const info: ActivationInfo = {
            email: email || data.accountId || '',
            licenseType: 'unknown', // backend doesn't expose type yet
            expiresAt: null,
            apiKey: provisionData.credentialRef
          }
          setActivationInfo(info)
          // Persist for IPC check on next launch
          try {
            await window.electronAPI.activation.save(info)
          } catch {
            /* ignore */
          }
          setStatus('activated')
        } else if (data.accountId) {
          // Logged in but no entitlement
          pendingEmailRef.current = data.accountId
          setStatus('need_purchase')
        } else {
          // Not logged in
          setStatus('need_login')
        }
      } catch (e) {
        // Network / server unavailable — treat as not logged in
        console.warn('[useActivation] bootstrap error:', e)
        setStatus('need_login')
      }
    },
    []
  )

  /** Called on component mount to auto-check activation. */
  const checkActivation = useCallback(async (): Promise<boolean> => {
    await checkBootstrap()
    return status === 'activated'
  }, [checkBootstrap, status])

  /** Send OTP code to email. */
  const sendCode = useCallback(async (email: string): Promise<boolean> => {
    setStatus('checking')
    setError(null)
    try {
      const data = await apiFetch<OtpSendResponse>('/auth/otp/send', {
        method: 'POST',
        body: JSON.stringify({ email })
      })
      if (data.ok) {
        pendingEmailRef.current = email
        setStatus('idle') // caller will advance to verify step
        return true
      } else {
        setError(data.error || 'Failed to send code')
        setStatus('error')
        return false
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error'
      setError(msg)
      setStatus('error')
      return false
    }
  }, [])

  /**
   * Verify OTP code.
   * On success, `redirectUrl` is opened in the browser.
   * The app listens for window focus and re-checks bootstrap on return.
   */
  const verifyCode = useCallback(
    async (email: string, code: string): Promise<boolean> => {
      setStatus('checking')
      setError(null)
      try {
        const data = await apiFetch<OtpVerifyResponse>('/auth/otp/verify', {
          method: 'POST',
          body: JSON.stringify({ email, code })
        })

        if (data.ok && data.verified) {
          pendingEmailRef.current = data.email || email

          if (data.redirectUrl) {
            // Open magiclink in external browser
            await window.electronAPI.system.openExternal(data.redirectUrl)
            // Set pending — will re-check bootstrap on window focus
            setStatus('pending_redirect')
          } else {
            // No redirect needed — directly re-check bootstrap
            await checkBootstrap(data.email || email)
          }
          return true
        } else {
          setError(data.error || 'Invalid code')
          setStatus('error')
          return false
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Network error'
        setError(msg)
        setStatus('error')
        return false
      }
    },
    [checkBootstrap]
  )

  /** Logout — clear local activation data. */
  const logout = useCallback(async (): Promise<void> => {
    setStatus('checking')
    try {
      await window.electronAPI.activation.logout()
    } catch {
      /* ignore */
    }
    setActivationInfo(null)
    setStatus('need_login')
  }, [])

  return {
    status,
    activationInfo,
    error,
    sendCode,
    verifyCode,
    checkActivation,
    logout
  }
}
