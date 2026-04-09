export function buildWebChatUrl(token: string): string {
  return `http://127.0.0.1:18789/#token=${encodeURIComponent(token)}`
}

export function resolveLaunchToken(params: {
  stateToken: string | null
  configToken?: string | null
}): { token: string | null; source: 'state' | 'config' | 'missing' } {
  const configToken = params.configToken ?? null

  if (configToken && configToken !== params.stateToken) {
    return { token: configToken, source: 'config' }
  }

  if (params.stateToken) {
    return { token: params.stateToken, source: 'state' }
  }

  if (configToken) {
    return { token: configToken, source: 'config' }
  }

  return { token: null, source: 'missing' }
}

export function describeWebChatLaunch(url: string): {
  mode: 'hash' | 'query' | 'missing'
  safeUrl: string
} {
  const parsed = new URL(url)
  const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash
  const hashParams = new URLSearchParams(hash)

  if (hashParams.has('token')) {
    hashParams.set('token', '<redacted>')
    parsed.hash = hashParams.toString()
    return { mode: 'hash', safeUrl: parsed.toString() }
  }

  if (parsed.searchParams.has('token')) {
    parsed.searchParams.set('token', '<redacted>')
    return { mode: 'query', safeUrl: parsed.toString() }
  }

  return { mode: 'missing', safeUrl: parsed.toString() }
}
