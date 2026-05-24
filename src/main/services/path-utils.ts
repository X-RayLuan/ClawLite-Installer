import { existsSync } from 'fs'
import { platform, homedir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'

const isWindows = platform() === 'win32'

// Resolve a Windows path like ~/AppData/Roaming to the actual path
const resolveHome = (p: string): string =>
  p.startsWith('~') ? join(homedir(), p.slice(1)) : p

export const PATH_DIRS = (() => {
  if (isWindows) {
    // Windows npm global bin (typically %APPDATA%\npm)
    const appData = process.env.APPDATA || resolveHome('~/AppData/Roaming')
    const npmGlobalBin = join(appData, 'npm')
    const voltaBin = resolveHome('~/.volta/bin')
    const nvmwBin = process.env.NVMW_BIN || ''
    return [
      npmGlobalBin,
      voltaBin,
      nvmwBin,
      // Also check standard npm global root\bin
      join(appData, 'npm', 'node_modules', '.bin')
    ].filter(Boolean)
  }

  // macOS / Linux
  const nvmBin = process.env.NVM_BIN || ''
  const nvmFromExec = process.execPath
    ? `${process.execPath.replace(/\/bin\/node$/, '')}/bin`
    : ''
  const all = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    nvmBin,
    nvmFromExec,
    resolveHome('~/.volta/bin'),
    resolveHome('~/.npm-global/bin')
  ].filter(Boolean)
  return [...new Set(all)]
})()

export const getPathEnv = (): NodeJS.ProcessEnv => {
  const separator = isWindows ? ';' : ':'
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: [...PATH_DIRS, process.env.PATH ?? ''].join(separator)
  }
  // Prevent MODULE_NOT_FOUND from referencing deleted ipv4-fix.js
  delete env.NODE_OPTIONS
  return env
}

// Try to find a binary in PATH (Windows-aware)
const findBinInPath = (name: string): string | null => {
  if (isWindows) {
    // On Windows, try .cmd, .exe, or bare name via 'where'
    const exts = ['.cmd', '.exe', '.bat', '']
    for (const dir of PATH_DIRS) {
      for (const ext of exts) {
        const p = join(dir, name + ext)
        if (existsSync(p)) return p
      }
    }
    // Fallback: use 'where' to search system PATH
    try {
      const result = spawnSync('where', [name], { shell: true, timeout: 5000 })
      if (result.status === 0 && result.stdout) {
        const firstLine = result.stdout.toString().split(/[\r\n]/)[0].trim()
        if (firstLine && existsSync(firstLine)) return firstLine
      }
    } catch { /* ignore */ }
    return null
  }

  // Unix: search PATH_DIRS then system PATH
  for (const dir of PATH_DIRS) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return null
}

export const findBin = (name: string): string => {
  if (isWindows) {
    const found = findBinInPath(name)
    if (found) return found
    // Last resort: return bare name and let spawn rely on PATH
    return name
  }
  for (const dir of PATH_DIRS) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return name
}
