import { spawn } from 'child_process'
import { platform } from 'os'
import { findBin } from './path-utils'

const TARGET_OPENCLAW_VERSION = '3.13'

export interface EnvCheckResult {
  os: 'macos' | 'windows' | 'linux'
  nodeInstalled: boolean
  nodeVersion: string | null
  nodeVersionOk: boolean
  openclawInstalled: boolean
  openclawVersion: string | null
  openclawLatestVersion: string | null
}

const PATH_EXTENSIONS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  process.env.NVM_BIN ?? '',
  `${process.env.HOME}/.volta/bin`,
  `${process.env.HOME}/.npm-global/bin`,
  '/usr/bin',
  '/bin'
]
  .filter(Boolean)
  .join(':')

const getEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: `${PATH_EXTENSIONS}:${process.env.PATH ?? ''}`
})

const runCommand = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: getEnv() })

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('timeout after 15000ms'))
    }, 15000)

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr || `exit code ${code}`))
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })

const parseVersion = (raw: string): string | null => {
  const match = raw.match(/v?(\d+\.\d+\.\d+)/)
  return match ? match[1] : null
}

const semverGte = (version: string, min: string): boolean => {
  const [a1, a2, a3] = version.split('.').map(Number)
  const [b1, b2, b3] = min.split('.').map(Number)
  if (a1 !== b1) return a1 > b1
  if (a2 !== b2) return a2 > b2
  return a3 >= b3
}

const fetchLatestVersion = async (_pkg: string): Promise<string> => {
  try {
    const res = await fetch(`https://registry.npmjs.org/${_pkg}/latest`)
    if (!res.ok) return TARGET_OPENCLAW_VERSION
    const json = (await res.json()) as { version?: string }
    return json.version ?? TARGET_OPENCLAW_VERSION
  } catch {
    return TARGET_OPENCLAW_VERSION
  }
}

const checkNodeAndOpenclaw = async (
  run: (cmd: string, args: string[]) => Promise<string>
): Promise<{
  nodeInstalled: boolean
  nodeVersion: string | null
  nodeVersionOk: boolean
  openclawInstalled: boolean
  openclawVersion: string | null
}> => {
  let nodeVersion: string | null = null
  let nodeInstalled = false
  let nodeVersionOk = false
  let openclawInstalled = false
  let openclawVersion: string | null = null

  try {
    const raw = await run('node', ['--version'])
    nodeVersion = parseVersion(raw)
    nodeInstalled = nodeVersion !== null
    nodeVersionOk = nodeVersion ? semverGte(nodeVersion, '24.15.0') : false
  } catch {
    /* not installed */
  }

  try {
    const raw = await run('npm', ['list', '-g', 'openclaw', '--json'])
    const json = JSON.parse(raw)
    const deps = json.dependencies?.openclaw
    if (deps) {
      openclawInstalled = true
      openclawVersion = deps.version ?? null
    }
  } catch {
    /* not installed */
  }

  if (!openclawInstalled || !openclawVersion) {
    const bins = ['openclaw', '/opt/homebrew/bin/openclaw', '/usr/local/bin/openclaw']
    for (const bin of bins) {
      try {
        const raw = await run(bin, ['--version'])
        const ver = parseVersion(raw)
        if (ver) {
          openclawInstalled = true
          openclawVersion = ver
          break
        }
      } catch {
        /* try next */
      }
    }
  }

  return { nodeInstalled, nodeVersion, nodeVersionOk, openclawInstalled, openclawVersion }
}

export interface OpenclawUpdateInfo {
  currentVersion: string | null
  latestVersion: string | null
}

export const checkOpenclawUpdate = async (): Promise<OpenclawUpdateInfo> => {
  const getCurrentVersion = async (): Promise<string | null> => {
    try {
      const raw = await runCommand('npm', ['list', '-g', 'openclaw', '--json'])
      const json = JSON.parse(raw)
      return json.dependencies?.openclaw?.version ?? null
    } catch {
      return null
    }
  }

  const getLatestVersion = async (): Promise<string | null> => {
    try {
      return await fetchLatestVersion('openclaw')
    } catch {
      return null
    }
  }

  const [currentVersion, latestVersion] = await Promise.all([
    getCurrentVersion(),
    getLatestVersion()
  ])

  return { currentVersion, latestVersion }
}

export const checkEnvironment = async (): Promise<EnvCheckResult> => {
  const os = platform() === 'darwin' ? 'macos' : platform() === 'win32' ? 'windows' : 'linux'

  let nodeInstalled = false
  let nodeVersion: string | null = null
  let nodeVersionOk = false
  let openclawInstalled = false
  let openclawVersion: string | null = null

  if (os === 'windows') {
    // Windows Native: use findBin to locate node/npm, then check openclaw
    const nodeBin = findBin('node')
    const npmBin = findBin('npm')
    const openclawBin = findBin('openclaw')

    const runWindows = async (cmd: string, args: string[]): Promise<string> =>
      new Promise((resolve, reject) => {
        const child = spawn(cmd, args)
        const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')) }, 15000)
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (d) => { stdout += d.toString() })
        child.stderr.on('data', (d) => { stderr += d.toString() })
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code === 0) resolve(stdout.trim())
          else reject(new Error(stderr || `exit ${code}`))
        })
        child.on('error', (e) => { clearTimeout(timer); reject(e) })
      })

    try {
      const raw = await runWindows(nodeBin, ['--version'])
      nodeVersion = parseVersion(raw)
      nodeInstalled = nodeVersion !== null
      nodeVersionOk = nodeVersion ? semverGte(nodeVersion, '24.15.0') : false
    } catch { /* not installed */ }

    try {
      const raw = await runWindows(npmBin, ['list', '-g', 'openclaw', '--json'])
      const json = JSON.parse(raw)
      if (json.dependencies?.openclaw) {
        openclawInstalled = true
        openclawVersion = json.dependencies.openclaw.version ?? null
      }
    } catch { /* try openclaw bin */ }

    if (!openclawInstalled || !openclawVersion) {
      try {
        const raw = await runWindows(openclawBin, ['--version'])
        const ver = parseVersion(raw)
        if (ver) {
          openclawInstalled = true
          openclawVersion = ver
        }
      } catch { /* not found */ }
    }
  } else {
    // macOS / Linux
    const result = await checkNodeAndOpenclaw(runCommand)
    nodeInstalled = result.nodeInstalled
    nodeVersion = result.nodeVersion
    nodeVersionOk = result.nodeVersionOk
    openclawInstalled = result.openclawInstalled
    openclawVersion = result.openclawVersion
  }

  let openclawLatestVersion: string | null = null

  try {
    openclawLatestVersion = await fetchLatestVersion('openclaw')
  } catch {
    /* network error — skip */
  }

  return {
    os,
    nodeInstalled,
    nodeVersion,
    nodeVersionOk,
    openclawInstalled,
    openclawVersion,
    openclawLatestVersion
  }
}
