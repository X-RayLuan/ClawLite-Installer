import { useState, useCallback, useRef } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivationStatus =
  | 'idle'
  | 'checking'
  | 'need_verify'
  | 'need_topup'
  | 'pending_topup'
  | 'activated'
  | 'need_skip_provider'
  | 'error'

export type LicenseType = 'annual' | 'lifetime' | 'trial' | 'unknown'

export interface ActivationInfo {
  email: string
  licenseType: LicenseType
  expiresAt: string | null // ISO date string, null for lifetime
  apiKey: string
  baseUrl: string
  balanceUsd?: number
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
  const url = `${API_BASE}${path}`
  console.log('[apiFetch] START', (options as any)?.method || 'GET', url, 'signal:', options?.signal ? 'yes' : 'no')
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    })
    console.log('[apiFetch] RESPONSE', res.status, res.ok, 'signal:', options?.signal ? 'yes' : 'no')
    const data = await res.json().catch(() => ({}))
    console.log('[apiFetch] DATA', JSON.stringify(data))
    if (!res.ok) {
      // Include the parsed body so callers can inspect structured error fields (e.g. provisioningState)
      const err: any = new Error((data as { error?: string }).error || `HTTP ${res.status}`)
      err._body = data
      err._status = res.status
      throw err
    }
    return data as T
  } catch (e) {
    console.error('[apiFetch] ERROR', e instanceof Error ? e.message : String(e), 'name:', (e as Error).name)
    throw e
  }
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
  provisioningState: 'bound' | 'unbound' | 'failed'
  bindingId?: string | null
  credentialRef?: string | null // API Key — only returned once
  provider?: string
  model?: string
  error?: string
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
    async (acctId: string, email: string, balanceUsd?: number): Promise<void> => {
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
          // Account has no active entitlement — throw so handleVerify can redirect to topup
          const err = new Error('need_topup')
          ;(err as any).needTopup = true
          throw err
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

        if (provisionData.provisioningState === 'failed') {
          const errMsg = provisionData.error || ''
          if (errMsg.includes('not active') || errMsg.includes('no entitlement')) {
            const err = new Error('need_topup')
            ;(err as any).needTopup = true
            throw err
          }
          throw new Error(errMsg || 'Activation failed')
        }

        const info: ActivationInfo = {
          email: email || acctId,
          licenseType: 'unknown',
          expiresAt: null,
          apiKey: provisionData.credentialRef!,
          baseUrl: 'https://clawlite.ai/api/openai',
          balanceUsd
        }
        setActivationInfo(info)
        try {
          await window.electronAPI.activation.save(info)
                  } catch (e) {
                    /* ignore */
        }
        // Skip Choose Provider step — clawlite is pre-configured via activation:save
        setStatus('need_skip_provider')
              } catch (e) {
        const err = e as any
        if (err?.needTopup) {
          // Redirect to topup
          setAccountId(acctId)
          setStatus('need_topup')
          return
        }
        const msg = e instanceof Error ? e.message : 'Activation failed'
        console.warn('[provisionAndActivate] failed:', msg)
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
          apiKey: provisionData.credentialRef!,
          baseUrl: 'https://clawlite.ai/api/openai',
        }
        setActivationInfo(info)
        try {
          await window.electronAPI.activation.save(info)
        } catch {
          /* ignore */
        }
        // Skip Choose Provider step — clawlite is pre-configured via activation:save
        setStatus('need_skip_provider')
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
    console.log('[useActivation] sendCode called with:', email, 'API_BASE:', API_BASE)
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)

      const data = await apiFetch<OtpSendResponse>('/auth/otp/send', {
        method: 'POST',
        body: JSON.stringify({ email }),
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      console.log('[useActivation] sendCode response:', data)
      if (data.ok) {
        pendingEmailRef.current = email
        setStatus('idle') // caller will advance to verify step
        return true
      } else {
        console.warn('[useActivation] sendCode API returned ok:false, error:', data.error)
        setError(data.error || 'Failed to send code')
        setStatus('error')
        return false
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error'
      console.error('[useActivation] sendCode exception:', msg, e)
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
        const accountId = data.accountId || email

        if (data.isActive) {
          // Has balance — provision and activate
          await provisionAndActivate(accountId, data.email || email, data.balanceUsd)
        } else {
          // No balance — show topup
          setAccountId(accountId)
          setStatus('need_topup')
        }
        return true
      } catch (e) {
        const err = e as any
        if (err?.needTopup) {
          // provisionAndActivate detected no active entitlement — redirect to topup
          setAccountId(pendingEmailRef.current || email)
          setStatus('need_topup')
          return false
        }
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
