import { spawn, ChildProcess } from 'child_process'
import http from 'http'
import { platform } from 'os'
import { getPathEnv, findBin } from './path-utils'
import { checkPort } from './troubleshooter'
import { t } from '../../shared/i18n/main'

export interface GatewayResult {
  status: string
  error?: string
}

// Windows WSL: keep gateway as a foreground process
let wslGatewayProcess: ChildProcess | null = null

// Gateway log callback (set from ipc-handlers)
let logCallback: ((msg: string) => void) | null = null

export const setGatewayLogCallback = (cb: ((msg: string) => void) | null): void => {
  logCallback = cb
}

const emitLog = (msg: string): void => {
  logCallback?.(msg)
}

const runGateway = (args: string[]): Promise<string> => {
  const openclaw = findBin('openclaw')
  const fullArgs = ['gateway', ...args]

  return new Promise((resolve, reject) => {
    const child = spawn(openclaw, fullArgs, {
      env: getPathEnv()
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr || `exit code ${code}`))
    })
    child.on('error', reject)
  })
}

const checkGatewayHttp = (): Promise<boolean> =>
  new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:18789/', { timeout: 1500 }, (res) => {
      res.resume()
      resolve(Boolean(res.statusCode && res.statusCode > 0))
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })

const waitForGatewayReady = async (timeoutMs = 30000): Promise<boolean> => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      // HTTP reachability is authoritative readiness
      const ok = await checkGatewayHttp()
      if (ok) return true

      // Port check as secondary hint only
      await checkPort().catch(() => ({ inUse: false }))
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 700))
  }
  return false
}

const startGatewayWsl = async (): Promise<GatewayResult> => {
  if (wslGatewayProcess) {
    wslGatewayProcess.kill()
    wslGatewayProcess = null
  }
  await killWslGateway()
  await new Promise((r) => setTimeout(r, 1000))

  return new Promise((resolve) => {
    const child = spawn(
      'wsl',
      [
        '-d',
        'Ubuntu',
        '-u',
        'root',
        '--',
        'bash',
        '-lc',
        'NODE_OPTIONS=--dns-result-order=ipv4first openclaw gateway run'
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )

    wslGatewayProcess = child

    let resolved = false
    let stderrBuffer = ''
    let readyBuf = ''
    let sawReadyHint = false

    child.stdout.on('data', (d) => {
      const raw = d.toString()
      const msg = raw.trim()
      if (msg) emitLog(msg)

      readyBuf = (readyBuf + raw).slice(-1024)
      if (/host mounted at http:\/\/127\.0\.0\.1:18789|gateway running|listening on/i.test(readyBuf)) {
        sawReadyHint = true
      }

      if (!resolved && /host mounted at http:\/\/127\.0\.0\.1:18789|gateway running|listening on/i.test(raw)) {
        resolved = true
        resolve({ status: 'started' })
      }
    })

    child.stderr.on('data', (d) => {
      const raw = d.toString()
      const msg = raw.trim()
      if (msg) {
        emitLog(msg)
        stderrBuffer += msg + '\n'
      }

      readyBuf = (readyBuf + raw).slice(-1024)
      if (/host mounted at http:\/\/127\.0\.0\.1:18789|gateway running|listening on/i.test(readyBuf)) {
        sawReadyHint = true
      }

      if (!resolved && /host mounted at http:\/\/127\.0\.0\.1:18789|gateway running|listening on/i.test(raw)) {
        resolved = true
        resolve({ status: 'started' })
      }
    })

    child.on('close', (code) => {
      wslGatewayProcess = null
      emitLog(t('gateway.processExit', { code }))
      if (code !== 0 && stderrBuffer) {
        emitLog(`${t('gateway.errorDetail')}\n${stderrBuffer.trim()}`)
      }
      if (!resolved) {
        resolved = true
        if (code !== 0) {
          resolve({ status: 'stopped', error: stderrBuffer.trim() || `exit code ${code}` })
        } else {
          resolve({ status: 'stopped' })
        }
      }
    })

    child.on('error', (err) => {
      wslGatewayProcess = null
      emitLog(t('gateway.error', { message: err.message }))
      if (!resolved) {
        resolved = true
        resolve({ status: 'error', error: err.message })
      }
    })

    setTimeout(async () => {
      if (!resolved) {
        const healthy = await waitForGatewayReady()
        if (healthy) {
          resolved = true
          resolve({ status: 'started' })
          return
        }

        // Fallback: if process is still alive and port is open, treat as started to avoid false negatives
        const port = await checkPort().catch(() => ({ inUse: false }))
        if (!resolved && child.exitCode === null && (port.inUse || sawReadyHint)) {
          resolved = true
          resolve({ status: 'started' })
          return
        }

        resolved = true
        resolve({ status: 'error', error: 'Gateway health check failed' })
      }
    }, 500)
  })
}

const killWslGateway = (): Promise<void> =>
  new Promise((resolve) => {
    const child = spawn('wsl', [
      '-d',
      'Ubuntu',
      '-u',
      'root',
      '--',
      'pkill',
      '-9',
      '-f',
      'openclaw'
    ])
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })

const stopGatewayWsl = async (): Promise<string> => {
  if (wslGatewayProcess) {
    wslGatewayProcess.kill()
    wslGatewayProcess = null
  }
  await killWslGateway()
  await new Promise((r) => setTimeout(r, 1000))
  return 'stopped'
}

const runDoctorFix = (): Promise<void> =>
  new Promise((resolve) => {
    const isWin = platform() === 'win32'
    let cmd: string
    let args: string[]

    if (isWin) {
      cmd = 'wsl'
      args = ['-d', 'Ubuntu', '-u', 'root', '--', 'bash', '-lc', 'openclaw doctor --fix']
    } else {
      cmd = findBin('openclaw')
      args = ['doctor', '--fix']
    }

    const child = spawn(cmd, args, {
      env: isWin ? process.env : getPathEnv()
    })
    child.stdout.on('data', (d) => {
      const msg = d.toString().trim()
      if (msg) emitLog(msg)
    })
    child.stderr.on('data', (d) => {
      const msg = d.toString().trim()
      if (msg) emitLog(msg)
    })
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })

const forceKillGateway = (): Promise<void> =>
  new Promise((resolve) => {
    const child = spawn('pkill', ['-f', 'openclaw gateway'])
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })

export const waitUntilStopped = async (timeoutMs = 5000): Promise<void> => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const { inUse } = await checkPort()
    if (!inUse) return
    await new Promise((r) => setTimeout(r, 500))
  }
  if (platform() !== 'win32') {
    await forceKillGateway()
    await new Promise((r) => setTimeout(r, 1000))
  }
}

export const startGateway = async (): Promise<GatewayResult> => {
  const isWin = platform() === 'win32'
  if (isWin) {
    const result = await startGatewayWsl()
    if (result.status === 'started') {
      await runDoctorFix()
    }
    return result
  }

  try {
    await runGateway(['start'])
    await runDoctorFix()
    return { status: 'started' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isServiceMissing =
      msg.includes('not loaded') || msg.includes('not installed') || msg.includes('bootstrap')
    const isMissingGatewayMode =
      msg.includes('missing gateway.mode') || msg.includes('gateway.mode')

    // Fix missing gateway.mode first, then retry
    if (isMissingGatewayMode) {
      emitLog('Config missing gateway.mode — applying fix...')
      try {
        // Use findBin directly — runGateway would incorrectly prefix 'gateway'
        await new Promise<void>((resolve, reject) => {
          const child = spawn(findBin('openclaw'), ['config', 'set', 'gateway.mode', 'local'], {
            env: isWin ? process.env : getPathEnv()
          })
          let stderr = ''
          child.stderr.on('data', (d) => (stderr += d.toString()))
          child.on('close', (code) =>
            code === 0 ? resolve() : reject(new Error(stderr || `exit code ${code}`))
          )
          child.on('error', reject)
        })
        await runGateway(['start'])
        await runDoctorFix()
        return { status: 'started' }
      } catch (fixErr) {
        const fixMsg = fixErr instanceof Error ? fixErr.message : String(fixErr)
        return { status: 'error', error: fixMsg }
      }
    }

    if (!isServiceMissing) return { status: 'error', error: msg }

    // Auto-install and retry when launchd service is not installed
    emitLog(t('gateway.notInstalledRetry'))
    try {
      await runGateway(['install'])
      await runGateway(['start'])
      await runDoctorFix()
      return { status: 'started' }
    } catch (retryErr) {
      const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
      return { status: 'error', error: retryMsg }
    }
  }
}

export const stopGateway = (): Promise<string> => {
  const isWin = platform() === 'win32'
  if (isWin) return stopGatewayWsl()
  return runGateway(['stop'])
}

export const restartGateway = async (): Promise<GatewayResult> => {
  // Guard stopGateway with a timeout to prevent indefinite hangs
  await Promise.race([
    (async () => {
      try {
        await stopGateway()
      } catch {
        /* already stopped */
      }
    })(),
    new Promise<void>((resolve) => setTimeout(resolve, 10000))
  ])
  await waitUntilStopped()
  return startGateway()
}

export const getGatewayStatus = async (): Promise<'running' | 'stopped'> => {
  if (platform() === 'win32') {
    if (wslGatewayProcess && !wslGatewayProcess.killed) return 'running'
    const httpReady = await checkGatewayHttp().catch(() => false)
    return httpReady ? 'running' : 'stopped'
  }
  try {
    const output = await runGateway(['status'])
    return output.toLowerCase().includes('running') ? 'running' : 'stopped'
  } catch {
    return 'stopped'
  }
}
