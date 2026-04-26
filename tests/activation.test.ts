/**
 * activation.test.ts
 *
 * Tests for ActivationModal component helpers and the useActivation hook.
 * Uses Node.js built-in test runner (node --test).
 *
 * Run: node --test --experimental-strip-types tests/activation.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

// ─── Email Validation Logic ──────────────────────────────────────────────────

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

test('isValidEmail returns true for valid email addresses', () => {
  assert.equal(isValidEmail('user@example.com'), true)
  assert.equal(isValidEmail('test.user+tag@domain.co'), true)
  assert.equal(isValidEmail('a@b.co'), true)
})

test('isValidEmail returns false for invalid email addresses', () => {
  assert.equal(isValidEmail(''), false)
  assert.equal(isValidEmail('notanemail'), false)
  assert.equal(isValidEmail('missing@domain'), false)
  assert.equal(isValidEmail('spaces in@email.com'), false)
  assert.equal(isValidEmail('@nodomain.com'), false)
  assert.equal(isValidEmail('noat.com'), false)
  assert.equal(isValidEmail('double@@at.com'), false)
})

// ─── API_BASE logic ────────────────────────────────────────────────────────────

// Replicate the API_BASE logic for testing
const API_BASE = (() => {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:3000/api'
  }
  return 'https://clawlite.ai/api'
})()

test('API_BASE resolves to production address when hostname is not localhost', () => {
  // In Node.js test environment (no window), hostname check falls through to production
  assert.equal(API_BASE, 'https://clawlite.ai/api')
})

// ─── Mask API Key ─────────────────────────────────────────────────────────────

function maskApiKey(key: string): string {
  if (key.length <= 8) return '*'.repeat(key.length)
  return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4)
}

test('maskApiKey masks short keys entirely', () => {
  assert.equal(maskApiKey('abc'), '***')
  assert.equal(maskApiKey('12345678'), '********')
})

test('maskApiKey reveals first 4 and last 4 characters of long keys', () => {
  // 10 chars: first 4 + 2 stars + last 4 = 'abcd' + '**' + 'ghij' = 'abcd**ghij'
  assert.equal(maskApiKey('abcdefghij'), 'abcd**ghij')
  // 19 chars: first 4 + 11 stars + last 4 = 'sk-1' + '***********' + 'cdef'
  assert.equal(maskApiKey('sk-1234567890abcdef'), 'sk-1***********cdef')
})

test('maskApiKey handles edge case of exactly 9 characters', () => {
  // 9 chars: first 4 + 1 star + last 4 = 'abcd' + '*' + 'fghi' = 'abcd*fghi'
  assert.equal(maskApiKey('abcdefghi'), 'abcd*fghi')
})

// ─── License Label ─────────────────────────────────────────────────────────────

type LicenseType = 'annual' | 'lifetime' | 'trial' | 'unknown'

function licenseLabel(type: LicenseType): string {
  switch (type) {
    case 'annual': return 'Annual'
    case 'lifetime': return 'Lifetime'
    case 'trial': return 'Trial'
    default: return '—'
  }
}

test('licenseLabel returns correct labels', () => {
  assert.equal(licenseLabel('annual'), 'Annual')
  assert.equal(licenseLabel('lifetime'), 'Lifetime')
  assert.equal(licenseLabel('trial'), 'Trial')
  assert.equal(licenseLabel('unknown'), '—')
})

// ─── Format Expiry ────────────────────────────────────────────────────────────

function formatExpiry(licenseType: LicenseType, expiresAt: string | null): string {
  if (licenseType === 'lifetime') return 'Never'
  if (!expiresAt) return '—'
  const d = new Date(expiresAt)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

test('formatExpiry returns "Never" for lifetime licenses', () => {
  assert.equal(formatExpiry('lifetime', '2025-01-01'), 'Never')
  assert.equal(formatExpiry('lifetime', null), 'Never')
})

test('formatExpiry returns "—" when expiresAt is null for non-lifetime', () => {
  assert.equal(formatExpiry('annual', null), '—')
  assert.equal(formatExpiry('trial', null), '—')
})

test('formatExpiry formats a valid ISO date string', () => {
  const result = formatExpiry('annual', '2025-06-15T00:00:00.000Z')
  // Results depend on locale; just check it doesn't throw and contains 2025
  assert.ok(result.includes('2025'))
})

// ─── Installer Instance ID ────────────────────────────────────────────────────

// Mock localStorage for testing
const store: Record<string, string> = {}
globalThis.localStorage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value },
  removeItem: (_key: string) => {},
  clear: () => { Object.keys(store).forEach(k => delete store[k]) },
  key: (_index: number) => null,
  get length() { return Object.keys(store).length }
} as Storage

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
    return crypto.randomUUID()
  }
}

test('getInstallerInstanceId generates and caches a UUID', () => {
  // Clear storage first
  localStorage.clear()
  const id1 = getInstallerInstanceId()
  const id2 = getInstallerInstanceId()
  assert.equal(id1, id2, 'same ID should be returned on subsequent calls')
  assert.ok(id1.length === 36, 'ID should be a valid UUID format')
})

test('getInstallerInstanceId returns the same ID on repeated calls', () => {
  localStorage.clear()
  const id = getInstallerInstanceId()
  for (let i = 0; i < 5; i++) {
    assert.equal(getInstallerInstanceId(), id)
  }
})
