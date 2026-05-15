import { existsSync } from 'fs'
import { platform } from 'os'
import { join } from 'path'

export const PATH_DIRS = (() => {
  const nvmBin = process.env.NVM_BIN || ''
  // Derive nvm bin from execPath when NVM_BIN is not set (e.g., in Electron)
  const nvmFromExec = process.execPath
    ? `${process.execPath.replace(/\/bin\/node$/, '')}/bin`
    : ''
  const all = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    nvmBin,
    nvmFromExec,
    `${process.env.HOME || ''}/.volta/bin`,
    `${process.env.HOME || ''}/.npm-global/bin`
  ].filter(Boolean)
  // Deduplicate
  return [...new Set(all)]
})()

export const getPathEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: [...PATH_DIRS, process.env.PATH ?? ''].join(':')
  }
  // Prevent MODULE_NOT_FOUND from referencing deleted ipv4-fix.js
  delete env.NODE_OPTIONS
  return env
}

export const findBin = (name: string): string => {
  if (platform() === 'win32') return name
  for (const dir of PATH_DIRS) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return name
}
