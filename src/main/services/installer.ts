import { spawn } from 'child_process'
import { StringDecoder } from 'string_decoder'
import { createWriteStream } from 'fs'
import { tmpdir, platform } from 'os'
import { join } from 'path'
import https from 'https'
import { BrowserWindow } from 'electron'

type ProgressCallback = (msg: string) => void

const sendProgress = (win: BrowserWindow, msg: string): void => {
  win.webContents.send('install:progress', msg)
}

const downloadFile = (url: string, dest: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const follow = (u: string): void => {
      https.get(u, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location)
          return
        }
        const file = createWriteStream(dest)
        res.pipe(file)
        file.on('finish', () => { file.close(); resolve() })
      }).on('error', reject)
    }
    follow(url)
  })

const runWithLog = (
  cmd: string,
  args: string[],
  onLog: ProgressCallback,
  options?: { shell?: boolean; env?: NodeJS.ProcessEnv }
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: options?.shell ?? false,
      env: { ...process.env, ...options?.env },
    })

    const outDecoder = new StringDecoder('utf8')
    const errDecoder = new StringDecoder('utf8')
    child.stdout.on('data', (d) => {
      outDecoder.write(d).split('\n').filter(Boolean).forEach(onLog)
    })
    child.stderr.on('data', (d) => {
      errDecoder.write(d).split('\n').filter(Boolean).forEach(onLog)
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Command failed: ${cmd} ${args.join(' ')} (exit ${code})`))
    })
    child.on('error', reject)
  })

export const installNodeMac = async (win: BrowserWindow): Promise<void> => {
  const log = (msg: string): void => sendProgress(win, msg)
  const url = `https://nodejs.org/dist/v22.14.0/node-v22.14.0.pkg`
  const dest = join(tmpdir(), 'node-installer.pkg')

  log('Node.js 22 다운로드 중...')
  await downloadFile(url, dest)
  log('Node.js 설치 창을 열고 있습니다...')
  await runWithLog('open', ['-W', dest], log)
  log('Node.js 설치 완료!')
}

export const installNodeWin = async (win: BrowserWindow): Promise<void> => {
  const log = (msg: string): void => sendProgress(win, msg)

  log('WSL 내 Node.js 22 설치 중...')
  const installScript =
    'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs'
  await runWithLog('wsl', ['-u', 'root', '--', 'bash', '-c', installScript], log)
  log('Node.js 설치 완료!')
}

export const installWsl = async (win: BrowserWindow): Promise<void> => {
  const log = (msg: string): void => sendProgress(win, msg)
  log('WSL2 설치 시작... (관리자 권한 필요)')
  try {
    await runWithLog('wsl', ['--install', '-d', 'Ubuntu', '--no-launch'], log, { shell: true })
  } catch {
    log('Ubuntu가 이미 설치되어 있습니다.')
  }
  log('Ubuntu 기본 사용자 설정 중...')
  try {
    await runWithLog('ubuntu', ['config', '--default-user', 'root'], log, { shell: true })
  } catch {
    await runWithLog('wsl', ['-d', 'Ubuntu', '-u', 'root', '--', 'true'], log, { shell: true })
  }
  log('WSL2 설치 완료! 재부팅이 필요할 수 있습니다.')
}

const getPathEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    `${process.env.HOME}/.nvm/versions/node`,
    `${process.env.HOME}/.volta/bin`,
    process.env.PATH ?? ''
  ].join(':')
})

export const installOpenClaw = async (win: BrowserWindow): Promise<void> => {
  const log = (msg: string): void => sendProgress(win, msg)
  log('OpenClaw 설치 중...')

  const cmd = platform() === 'win32' ? 'wsl' : 'npm'
  const args = platform() === 'win32'
    ? ['-u', 'root', '--', 'npm', 'install', '-g', 'openclaw@latest']
    : ['install', '-g', 'openclaw@latest']

  await runWithLog(cmd, args, log, { shell: true, env: getPathEnv() })
  log('OpenClaw 설치 완료!')
}
