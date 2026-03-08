import { spawn } from 'child_process'
import { StringDecoder } from 'string_decoder'
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import https from 'https'
import { BrowserWindow } from 'electron'
import { runInWsl } from './wsl-utils'
import { getPathEnv } from './path-utils'
import { t } from '../../shared/i18n/main'

type ProgressCallback = (msg: string) => void

interface RunError extends Error {
  lines?: string[]
}

const sendProgress = (win: BrowserWindow, msg: string): void => {
  win.webContents.send('install:progress', msg)
}

const downloadFile = (url: string, dest: string, maxRedirects = 5): Promise<void> =>
  new Promise((resolve, reject) => {
    let redirectCount = 0
    const follow = (u: string): void => {
      https
        .get(u, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume()
            if (++redirectCount > maxRedirects) {
              reject(new Error('Too many redirects'))
              return
            }
            follow(res.headers.location)
            return
          }
          if (!res.statusCode || res.statusCode >= 400) {
            res.resume()
            reject(new Error(`HTTP ${res.statusCode}`))
            return
          }
          const file = createWriteStream(dest)
          res.pipe(file)
          file.on('finish', () => {
            file.close()
            resolve()
          })
          file.on('error', reject)
        })
        .on('error', reject)
    }
    follow(url)
  })

const runWithLog = (
  cmd: string,
  args: string[],
  onLog: ProgressCallback,
  options?: { shell?: boolean; env?: NodeJS.ProcessEnv; cwd?: string }
): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: options?.shell ?? false,
      env: options?.env ?? process.env,
      cwd: options?.cwd
    })

    const lines: string[] = []
    const outDecoder = new StringDecoder('utf8')
    const errDecoder = new StringDecoder('utf8')
    child.stdout.on('data', (d) => {
      outDecoder
        .write(d)
        .split('\n')
        .filter(Boolean)
        .forEach((l) => {
          onLog(l)
          lines.push(l)
        })
    })
    child.stderr.on('data', (d) => {
      errDecoder
        .write(d)
        .split('\n')
        .filter(Boolean)
        .forEach((l) => {
          onLog(l)
          lines.push(l)
        })
    })
    child.on('close', (code) => {
      if (code === 0) resolve(lines)
      else {
        const err: RunError = new Error(`Command failed: ${cmd} ${args.join(' ')} (exit ${code})`)
        err.lines = lines
        reject(err)
      }
    })
    child.on('error', reject)
  })

// ─── WSL installation functions (Windows) ───

/** Install WSL itself (wsl --install -d Ubuntu --no-launch) — UAC elevation */
export const installWsl = async (win: BrowserWindow): Promise<{ needsReboot: boolean }> => {
  const log = (msg: string): void => sendProgress(win, msg)

  log(t('installer.wslInstalling'))
  log(t('installer.wslAdminPrompt'))
  try {
    const psCommand = [
      'try {',
      "  $p = Start-Process -FilePath 'wsl' -ArgumentList '--install -d Ubuntu --no-launch' -Verb RunAs -Wait -PassThru;",
      '  exit $p.ExitCode',
      '} catch {',
      '  Write-Output $_.Exception.Message;',
      '  exit 1',
      '}'
    ].join(' ')
    await runWithLog('powershell', ['-NoProfile', '-Command', psCommand], log)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : ''
    const errLines = ((err as RunError).lines ?? []).join('\n')
    const combined = errMsg + '\n' + errLines

    // Log full error for debugging
    log('WSL installation error details:')
    log(combined)

    // exit 4294967295 = ERROR_ALREADY_EXISTS: Ubuntu already registered
    if (combined.includes('4294967295')) {
      log(t('installer.ubuntuAlreadyRegistered'))
      try {
        await runInWsl('echo initialized', 30000)
        log(t('installer.ubuntuInitDone'))
        return { needsReboot: false }
      } catch {
        throw new Error(`WSL already installed but not responding. Full error: ${combined}`)
      }
    }
    const lower = combined.toLowerCase()

    // User denied UAC or permission error
    if (
      lower.includes('canceled') ||
      lower.includes('cancelled') ||
      lower.includes('elevation') ||
      lower.includes('access denied') ||
      lower.includes('permission')
    ) {
      throw new Error(`${t('installer.adminRequired')} - Please run the installer as Administrator.`)
    }
    // wsl command not found (unsupported Windows version)
    if (lower.includes('not recognized') || lower.includes('not found')) {
      throw new Error(`${t('installer.windowsVersionError')} - WSL requires Windows 10 version 1903+ or Windows 11.`)
    }
    // Virtualization disabled
    if (lower.includes('virtualization') || lower.includes('hyper-v')) {
      throw new Error(`${t('installer.biosVirtualization')} - Please enable Virtualization (VT-x/AMD-V) in BIOS settings.`)
    }
    
    // Generic error with full details
    throw new Error(`WSL installation failed. Details: ${combined}`)
  }
  log(t('installer.wslDone'))
  return { needsReboot: true }
}

/** Install Node.js 22 LTS inside WSL Ubuntu (NodeSource apt repo) */
export const installNodeWsl = async (win: BrowserWindow): Promise<void> => {
  const log = (msg: string): void => sendProgress(win, msg)

  log(t('installer.wslPackages'))
  try {
    await runInWsl('apt-get update && apt-get install -y curl ca-certificates gnupg', 60000)
  } catch {
    log(t('installer.aptFailed'))
  }

  log(t('installer.nodeWslInstalling'))
  await runInWsl(
    'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs',
    120000
  )

  log(t('installer.nodeWslDone'))
}

/** Install openclaw globally inside WSL Ubuntu */
export const installOpenClawWsl = async (win: BrowserWindow): Promise<void> => {
  const log = (msg: string): void => sendProgress(win, msg)
  log(t('installer.ocWslInstalling'))
  
  // Detect best npm registry based on network latency
  log('Detecting fastest npm registry...')
  const registries = [
    { name: 'npmmirror (China)', url: 'https://registry.npmmirror.com' },
    { name: 'npm official', url: 'https://registry.npmjs.org' },
    { name: 'Tencent Cloud (China)', url: 'https://mirrors.cloud.tencent.com/npm/' }
  ]
  
  let fastestRegistry = registries[1].url // default to official
  try {
    // Quick ping test to find fastest registry
    const testCmd = registries.map(r => 
      `curl -o /dev/null -s -w '%{time_total}' -m 3 ${r.url} || echo 999`
    ).join(' & ')
    
    const times = await runInWsl(`bash -c "${testCmd}; wait"`, 15000)
    const latencies = times.split('\n').map(t => parseFloat(t.trim()))
    const fastestIdx = latencies.indexOf(Math.min(...latencies))
    
    if (fastestIdx >= 0 && latencies[fastestIdx] < 10) {
      fastestRegistry = registries[fastestIdx].url
      log(`Using ${registries[fastestIdx].name} (${latencies[fastestIdx].toFixed(2)}s)`)
    }
  } catch {
    log('Registry detection failed, using default')
  }
  
  try {
    log(`Installing openclaw from ${fastestRegistry}...`)
    await runInWsl(`npm install -g openclaw@latest --registry=${fastestRegistry} --verbose`, 300000)
  } catch (err) {
    // Fallback to official registry
    log('Retrying with official npm registry...')
    await runInWsl('npm install -g openclaw@latest --verbose', 300000)
  }
  
  log(t('installer.ocWslDone'))
}

// ─── macOS installation functions ───

export const installNodeMac = async (win: BrowserWindow): Promise<void> => {
  const log = (msg: string): void => sendProgress(win, msg)
  const url = `https://nodejs.org/dist/v22.14.0/node-v22.14.0.pkg`
  const dest = join(tmpdir(), 'node-installer.pkg')

  log(t('installer.nodeDownloading'))
  await downloadFile(url, dest)
  log(t('installer.nodeInstallerOpening'))
  await runWithLog('open', ['-W', dest], log)
  log(t('installer.nodeDone'))
}

// getPathEnv imported from path-utils.ts (includes NODE_OPTIONS removal)

const isXcodeCliInstalled = (): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn('xcode-select', ['-p'])
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })

const ensureXcodeCli = async (log: ProgressCallback): Promise<void> => {
  if (await isXcodeCliInstalled()) return

  log(t('installer.xcodeOpening'))
  spawn('xcode-select', ['--install'])

  log(t('installer.xcodePrompt'))
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    if (await isXcodeCliInstalled()) {
      log(t('installer.xcodeDone'))
      return
    }
  }
  throw new Error(t('installer.xcodeTimeout'))
}

export const installOpenClaw = async (win: BrowserWindow): Promise<void> => {
  const log = (msg: string): void => sendProgress(win, msg)
  log(t('installer.ocInstalling'))

  await ensureXcodeCli(log)
  const npmCacheDir = join(homedir(), '.npm')
  if (existsSync(npmCacheDir)) {
    const uid = process.getuid?.() ?? 501
    const gid = process.getgid?.() ?? 20
    await runWithLog('chown', ['-R', `${uid}:${gid}`, npmCacheDir], log).catch(() => {})
  }
  const npmGlobalDir = join(homedir(), '.npm-global')
  if (!existsSync(npmGlobalDir)) mkdirSync(npmGlobalDir, { recursive: true })
  await runWithLog('npm', ['config', 'set', 'prefix', npmGlobalDir], log, {
    env: getPathEnv()
  })
  await runWithLog('npm', ['install', '-g', 'openclaw@latest'], log, {
    env: getPathEnv()
  })

  log(t('installer.ocDone'))
}
