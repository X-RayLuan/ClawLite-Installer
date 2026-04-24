import { useState, useCallback } from 'react'

export type ActivationStatus = 'idle' | 'loading' | 'activated' | 'unactivated' | 'error'

export type LicenseType = 'annual' | 'lifetime' | 'trial' | 'unknown'

export interface ActivationInfo {
  email: string
  licenseType: LicenseType
  expiresAt: string | null // ISO date string, null for lifetime
  apiKey: string
}

const API_BASE = 'http://localhost:3000/api'

interface SendCodeResponse {
  success: boolean
  error?: string
}

interface VerifyCodeResponse {
  success: boolean
  error?: string
  activationInfo?: ActivationInfo
}

interface CheckActivationResponse {
  activated: boolean
  activationInfo?: ActivationInfo
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function useActivation() {
  const [status, setStatus] = useState<ActivationStatus>('idle')
  const [activationInfo, setActivationInfo] = useState<ActivationInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sendCode = useCallback(async (email: string): Promise<boolean> => {
    setStatus('loading')
    setError(null)
    try {
      const data = await apiFetch<SendCodeResponse>('/auth/send-code', {
        method: 'POST',
        body: JSON.stringify({ email })
      })
      if (data.success) {
        setStatus('idle')
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

  const verifyCode = useCallback(
    async (email: string, code: string): Promise<boolean> => {
      setStatus('loading')
      setError(null)
      try {
        const data = await apiFetch<VerifyCodeResponse>('/auth/verify-code', {
          method: 'POST',
          body: JSON.stringify({ email, code })
        })
        if (data.success && data.activationInfo) {
          setActivationInfo(data.activationInfo)
          // Persist to local activation file so IPC check works on next launch
          try {
            await window.electronAPI.activation.save(data.activationInfo)
          } catch {
            /* ignore save errors — API already confirmed success */
          }
          setStatus('activated')
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
    []
  )

  const checkActivation = useCallback(async (): Promise<boolean> => {
    setStatus('loading')
    setError(null)
    try {
      // Try via IPC first (backend can read from local file), fallback to HTTP
      let data: CheckActivationResponse | null = null
      try {
        data = await window.electronAPI.activation.check()
      } catch {
        // fallback to HTTP
      }
      if (!data) {
        data = await apiFetch<CheckActivationResponse>('/auth/check')
      }
      if (data.activated && data.activationInfo) {
        setActivationInfo(data.activationInfo)
        setStatus('activated')
        return true
      } else {
        setStatus('unactivated')
        return false
      }
    } catch {
      // Network/server not available → treat as unactivated
      setStatus('unactivated')
      return false
    }
  }, [])

  const logout = useCallback(async (): Promise<void> => {
    setStatus('loading')
    try {
      await window.electronAPI.activation.logout()
      setActivationInfo(null)
      setStatus('unactivated')
    } catch {
      setStatus('unactivated')
    }
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
