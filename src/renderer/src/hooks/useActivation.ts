import { useState, useCallback, useRef } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivationStatus =
  | 'idle'
  | 'checking'
  | 'need_verify'
  | 'need_topup'
  | 'pending_topup'
  | 'activated'
  | 'error'

export type LicenseType = 'annual' | 'lifetime' | 'trial' | 'unknown'

export interface ActivationInfo {
  email: string
  licenseType: LicenseType
  expiresAt: string | null // ISO date string, null for lifetime
  apiKey: string
}

const API_BASE = (() => {
  // 渲染进程没有 localhost 服务器，改用生产地址
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:3000/api'
  }
  return 'https://clawlite.ai/api'
})()

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

// Verify OTP response (new endpoint)
interface VerifyOtpResponse {
  ok: boolean
  accountId?: string
  email?: string
  isActive?: boolean
  balanceUsd?: number
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

// Topup checkout response
interface TopupCheckoutResponse {
  ok: boolean
  checkoutUrl?: string
  error?: string
}

// Check topup status response
interface TopupStatusResponse {
  isActive: boolean
  balanceUsd: number
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useActivation() {
  const [status, setStatus] = useState<ActivationStatus>('idle')
  const [activationInfo, setActivationInfo] = useState<ActivationInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)

  // Tracks the email being verified
  const pendingEmailRef = useRef<string | null>(null)

  // Polling interval ref for topup
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /**
   * Bootstrap + provision — get API key and save.
   */
  const provisionAndActivate = useCallback(
    async (acctId: string, email: string): Promise<void> => {
      try {
        const instanceId = getInstallerInstanceId()
        const bootstrapData = await apiFetch<BootstrapResponse>('/installer/activation/bootstrap', {
          method: 'POST',
          body: JSON.stringify({
            installerInstanceId: instanceId,
            accountId: acctId,
            platform: 'installer'
          })
        })

        if (bootstrapData.entitlement.status !== 'active') {
          throw new Error('Account is not active')
        }

        const provisionData = await apiFetch<ProvisionResponse>(
          '/installer/activation/provision',
          {
            method: 'POST',
            body: JSON.stringify({
              setupToken: bootstrapData.setupToken,
              accountId: acctId
            })
          }
        )

        const info: ActivationInfo = {
          email: email || acctId,
          licenseType: 'unknown',
          expiresAt: null,
          apiKey: provisionData.credentialRef
        }
        setActivationInfo(info)
        try {
          await window.electronAPI.activation.save(info)
        } catch {
          /* ignore */
        }
        setStatus('activated')
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Activation failed'
        setError(msg)
        setStatus('error')
      }
    },
    []
  )

  /**
   * Called on mount to auto-check activation.
   */
  const checkActivation = useCallback(async (): Promise<boolean> => {
    setStatus('checking')
    setError(null)
    try {
      const instanceId = getInstallerInstanceId()
      const data = await apiFetch<BootstrapResponse>('/installer/activation/bootstrap', {
        method: 'POST',
        body: JSON.stringify({
          installerInstanceId: instanceId,
          platform: 'installer'
        })
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
          email: data.accountId || '',
          licenseType: 'unknown',
          expiresAt: null,
          apiKey: provisionData.credentialRef
        }
        setActivationInfo(info)
        try {
          await window.electronAPI.activation.save(info)
        } catch {
          /* ignore */
        }
        setStatus('activated')
      } else if (data.accountId) {
        // Logged in but no entitlement — prompt topup
        setAccountId(data.accountId)
        setStatus('need_topup')
      } else {
        // Not logged in
        setStatus('need_verify')
      }
    } catch (e) {
      console.warn('[useActivation] bootstrap error:', e)
      setStatus('need_verify')
    }
    return status === 'activated'
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

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
   * Verify OTP code via the new /installer/auth/verify-otp endpoint.
   * Returns isActive + accountId directly — no browser redirect.
   */
  const verifyCode = useCallback(
    async (email: string, code: string): Promise<boolean> => {
      setStatus('checking')
      setError(null)
      try {
        const data = await apiFetch<VerifyOtpResponse>('/installer/auth/verify-otp', {
          method: 'POST',
          body: JSON.stringify({ email, code })
        })

        if (!data.ok) {
          setError(data.error || 'Invalid code')
          setStatus('error')
          return false
        }

        pendingEmailRef.current = data.email || email

        if (data.isActive) {
          // Has balance — provision and activate
          await provisionAndActivate(data.accountId || email, data.email || email)
        } else {
          // No balance — show topup
          setAccountId(data.accountId || email)
          setStatus('need_topup')
        }
        return true
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Network error'
        setError(msg)
        setStatus('error')
        return false
      }
    },
    [provisionAndActivate]
  )

  /**
   * Start topup: create Stripe checkout and open browser.
   */
  const startTopup = useCallback(
    async (amount: 5 | 10 | 20): Promise<boolean> => {
      if (!accountId) return false
      setStatus('checking')
      setError(null)
      try {
        const email = pendingEmailRef.current || ''
        const data = await apiFetch<TopupCheckoutResponse>('/installer/topup/checkout', {
          method: 'POST',
          body: JSON.stringify({ accountId, email, amount })
        })

        if (!data.ok || !data.checkoutUrl) {
          throw new Error(data.error || 'Failed to create checkout')
        }

        // Open Stripe checkout in browser
        await window.electronAPI.system.openExternal(data.checkoutUrl)
        setStatus('pending_topup')

        // Start polling for topup completion
        let attempts = 0
        const maxAttempts = 60

        pollingRef.current = setInterval(async () => {
          attempts++
          try {
            const statusData = await apiFetch<TopupStatusResponse>(
              `/installer/topup/check-status?accountId=${encodeURIComponent(accountId)}`
            )
            if (statusData.isActive) {
              if (pollingRef.current) clearInterval(pollingRef.current)
              pollingRef.current = null
              await provisionAndActivate(accountId, email)
            } else if (attempts >= maxAttempts) {
              if (pollingRef.current) clearInterval(pollingRef.current)
              pollingRef.current = null
              setError('Payment is taking longer than expected. Please try again later.')
              setStatus('need_topup')
            }
          } catch {
            // Keep polling on individual poll failure
            if (attempts >= maxAttempts) {
              if (pollingRef.current) clearInterval(pollingRef.current)
              pollingRef.current = null
              setError('Failed to check payment status. Please try again later.')
              setStatus('need_topup')
            }
          }
        }, 3000)

        return true
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to start topup'
        setError(msg)
        setStatus('need_topup')
        return false
      }
    },
    [accountId, provisionAndActivate]
  )

  /** Cancel pending topup and return to topup selection. */
  const cancelTopup = useCallback((): void => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    setStatus('need_topup')
  }, [])

  /** Logout — clear local activation data. */
  const logout = useCallback(async (): Promise<void> => {
    setStatus('checking')
    try {
      await window.electronAPI.activation.logout()
    } catch {
      /* ignore */
    }
    setActivationInfo(null)
    setAccountId(null)
    setStatus('need_verify')
  }, [])

  return {
    status,
    activationInfo,
    error,
    accountId,
    sendCode,
    verifyCode,
    checkActivation,
    startTopup,
    cancelTopup,
    logout
  }
}
