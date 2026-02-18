import { spawn, execSync } from 'child_process'
import { existsSync } from 'fs'
import { platform } from 'os'
import { join } from 'path'

const PATH_DIRS = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  `${process.env.HOME}/.nvm/versions/node`,
  `${process.env.HOME}/.volta/bin`
]

const getPathEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: [...PATH_DIRS, process.env.PATH ?? ''].join(':')
})

const findOpenclawBin = (): string => {
  if (platform() === 'win32') return 'openclaw'

  for (const dir of PATH_DIRS) {
    const p = join(dir, 'openclaw')
    if (existsSync(p)) return p
  }

  try {
    const prefix = execSync('npm prefix -g', { env: getPathEnv() }).toString().trim()
    const p = join(prefix, 'bin', 'openclaw')
    if (existsSync(p)) return p
  } catch { /* ignore */ }

  return 'openclaw'
}

const runGateway = (args: string[]): Promise<string> => {
  const isWindows = platform() === 'win32'
  const openclaw = findOpenclawBin()
  const cmd = isWindows ? 'wsl' : openclaw
  const fullArgs = isWindows
    ? ['--', 'openclaw', 'gateway', ...args]
    : ['gateway', ...args]

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, fullArgs, {
      shell: isWindows,
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

export const startGateway = (): Promise<string> => runGateway(['start'])

export const stopGateway = (): Promise<string> => runGateway(['stop'])

export const getGatewayStatus = async (): Promise<'running' | 'stopped'> => {
  try {
    const output = await runGateway(['status'])
    return output.toLowerCase().includes('running') ? 'running' : 'stopped'
  } catch {
    return 'stopped'
  }
}
