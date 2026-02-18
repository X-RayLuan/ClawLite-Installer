import { spawn, execSync } from 'child_process'
import { existsSync } from 'fs'
import { platform } from 'os'
import { join } from 'path'
import { BrowserWindow } from 'electron'

interface OnboardConfig {
  anthropicApiKey: string
  telegramBotToken?: string
}

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

const findOpenclawBin = (log: (msg: string) => void): string => {
  if (platform() === 'win32') return 'openclaw'

  // 1) 알려진 경로에서 직접 탐색
  for (const dir of PATH_DIRS) {
    const p = join(dir, 'openclaw')
    if (existsSync(p)) {
      log(`openclaw 경로: ${p}`)
      return p
    }
  }

  // 2) npm prefix -g 로 동적 탐색
  try {
    const prefix = execSync('npm prefix -g', { env: getPathEnv() }).toString().trim()
    const p = join(prefix, 'bin', 'openclaw')
    if (existsSync(p)) {
      log(`openclaw 경로 (npm): ${p}`)
      return p
    }
  } catch { /* ignore */ }

  log('openclaw을 찾지 못해 PATH에서 탐색합니다')
  return 'openclaw'
}

const runCmd = (
  cmd: string,
  args: string[],
  onLog: (msg: string) => void
): Promise<void> =>
  new Promise((resolve, reject) => {
    const isWindows = platform() === 'win32'
    const fullCmd = isWindows ? 'wsl' : cmd
    const fullArgs = isWindows ? ['--', cmd, ...args] : args

    onLog(`실행: ${fullCmd} ${fullArgs[0]} ...`)

    const child = spawn(fullCmd, fullArgs, {
      shell: isWindows,
      env: getPathEnv()
    })

    child.stdout.on('data', (d) =>
      d.toString().split('\n').filter(Boolean).forEach(onLog)
    )
    child.stderr.on('data', (d) =>
      d.toString().split('\n').filter(Boolean).forEach(onLog)
    )
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Command failed with exit code ${code}`))
    })
    child.on('error', reject)
  })

export const runOnboard = async (
  win: BrowserWindow,
  config: OnboardConfig
): Promise<void> => {
  const log = (msg: string): void => {
    win.webContents.send('install:progress', msg)
  }

  log('OpenClaw 초기 설정 시작...')

  const openclaw = findOpenclawBin(log)

  const onboardArgs = [
    'onboard',
    '--non-interactive',
    '--accept-risk',
    '--mode', 'local',
    '--auth-choice', 'apiKey',
    '--anthropic-api-key', config.anthropicApiKey,
    '--gateway-port', '18789',
    '--gateway-bind', 'loopback',
    '--install-daemon',
    '--daemon-runtime', 'node',
    '--skip-skills'
  ]

  await runCmd(openclaw, onboardArgs, log)
  log('기본 설정 완료!')

  if (config.telegramBotToken) {
    log('텔레그램 채널 추가 중...')
    await runCmd(openclaw, [
      'channels', 'add',
      '--channel', 'telegram',
      '--token', config.telegramBotToken
    ], log)
    log('텔레그램 채널 추가 완료!')
  }
}
