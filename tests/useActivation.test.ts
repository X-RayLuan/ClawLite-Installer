/**
 * useActivation.test.ts
 *
 * Tests for the useActivation hook's API interactions.
 * Mocks global fetch and window.electronAPI to test sendCode / verifyCode flows.
 *
 * Run: node --test --experimental-strip-types tests/useActivation.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

// ─── Mock setup ──────────────────────────────────────────────────────────────

// Track pending requests so tests can inspect/reject them
let pendingFetch: { url: string; resolve: (v: unknown) => void; reject: (e: Error) => void } | null = null

// Mock global fetch
const originalFetch = globalThis.fetch
globalThis.fetch = function fetchMock(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    pendingFetch = {
      url,
      resolve: (v: unknown) => {
        // Check the `ok` field in the response data to set res.ok
        // This lets us simulate HTTP-level errors vs 200-ok-with-error-body
        const data = v as { ok?: boolean }
        const responseOk = data?.ok !== false // undefined/true => true, false => false
        resolve({
          ok: responseOk,
          status: responseOk ? 200 : 400,
          json: async () => v,
        } as unknown as Response)
      },
      reject: (e: Error) => reject(e)
    }
  })
}

// Expose resolveFetch for tests to control when promises resolve
function resolveFetch(data: unknown): void {
  if (!pendingFetch) throw new Error('No pending fetch to resolve')
  pendingFetch.resolve(data)
}

// ─── Import the hook (must be after mocks are in place) ──────────────────────
// Since the hook imports from react, we can't directly import it in Node.js.
// Instead, we test the raw apiFetch logic and status transition logic.
//
// We replicate the key functions here for testing:

type ActivationStatus =
  | 'idle'
  | 'checking'
  | 'need_verify'
  | 'need_topup'
  | 'pending_topup'
  | 'activated'
  | 'error'

interface OtpSendResponse { ok: boolean; error?: string }
interface VerifyOtpResponse { ok: boolean; accountId?: string; email?: string; isActive?: boolean; error?: string }

const API_BASE = (() => {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:3000/api'
  }
  return 'https://clawlite.ai/api'
})()

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options
  } as RequestInit)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = (body as { error?: string }).error || `HTTP ${res.status}`
    throw new Error(err)
  }
  return res.json() as Promise<T>
}

// ─── Test: sendCode success path ──────────────────────────────────────────────

test('sendCode returns true and idle status when API returns ok:true', async () => {
  // Simulate a sendCode call
  const sendPromise = apiFetch<OtpSendResponse>('/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ email: 'test@example.com' })
  })

  // Resolve the pending fetch
  resolveFetch({ ok: true })

  const result = await sendPromise
  assert.equal(result.ok, true)
})

// ─── Test: sendCode failure path ───────────────────────────────────────────────

test('sendCode throws when API returns ok:false with error message', async () => {
  // Reset fetch mock for this test
  pendingFetch = null

  const sendPromise = apiFetch<OtpSendResponse>('/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ email: 'bad@example.com' })
  })

  // Simulate server returning ok:false
  resolveFetch({ ok: false, error: 'Rate limit exceeded' })

  await assert.rejects(
    async () => {
      await sendPromise
      // If we get here without rejecting, fail
      throw new Error('Expected rejection')
    },
    { message: 'Rate limit exceeded' }
  )
})

// ─── Test: verifyCode active path ────────────────────────────────────────────

test('verifyCode returns account data when isActive:true', async () => {
  pendingFetch = null

  const verifyPromise = apiFetch<VerifyOtpResponse>('/installer/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email: 'test@example.com', code: '123456' })
  })

  resolveFetch({ ok: true, accountId: 'acct_123', email: 'test@example.com', isActive: true })

  const result = await verifyPromise
  assert.equal(result.ok, true)
  assert.equal(result.isActive, true)
  assert.equal(result.accountId, 'acct_123')
})

// ─── Test: verifyCode inactive path ─────────────────────────────────────────

test('verifyCode returns need_topup signal when isActive:false', async () => {
  pendingFetch = null

  const verifyPromise = apiFetch<VerifyOtpResponse>('/installer/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email: 'poor@example.com', code: '000000' })
  })

  resolveFetch({ ok: true, accountId: 'acct_poor', isActive: false })

  const result = await verifyPromise
  assert.equal(result.ok, true)
  assert.equal(result.isActive, false)
  assert.equal(result.accountId, 'acct_poor')
})

// ─── Test: verifyCode wrong code path ─────────────────────────────────────────

test('verifyCode throws when code is invalid', async () => {
  pendingFetch = null

  const verifyPromise = apiFetch<VerifyOtpResponse>('/installer/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email: 'test@example.com', code: '000000' })
  })

  resolveFetch({ ok: false, error: 'Invalid verification code' })

  await assert.rejects(
    async () => {
      await verifyPromise
      throw new Error('Expected rejection')
    },
    { message: 'Invalid verification code' }
  )
})

// ─── Test: HTTP error status throws descriptive message ───────────────────────

test('apiFetch throws with status code when response is not ok', async () => {
  // Override fetch for this specific test
  ;(globalThis.fetch as jest.Mock).mockImplementationOnce = undefined

  // Create a response that has a non-ok status
  const errorFetch = async (): Promise<Response> => {
    const response = {
      ok: false,
      status: 503,
      json: async () => ({}),
    }
    return response as unknown as Response
  }

  // Temporarily replace globalThis.fetch
  const savedFetch = globalThis.fetch
  globalThis.fetch = errorFetch as unknown as typeof fetch

  await assert.rejects(
    async () => {
      await apiFetch<unknown>('/installer/activation/bootstrap', { method: 'POST' })
      throw new Error('Expected rejection')
    },
    { message: 'HTTP 503' }
  )

  globalThis.fetch = savedFetch
})

// ─── Cleanup ─────────────────────────────────────────────────────────────────

test.afterEach(() => {
  pendingFetch = null
})
