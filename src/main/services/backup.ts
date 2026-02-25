import { spawn } from 'child_process'
import { existsSync, createWriteStream, createReadStream } from 'fs'
import { homedir, platform } from 'os'
import { join } from 'path'
import { BrowserWindow, dialog } from 'electron'
import { stopGateway, startGateway, getGatewayStatus } from './gateway'
import { runInWsl } from './wsl-utils'

const openclawDir = (): string => join(homedir(), '.openclaw')

const forceKillGateway = (): Promise<void> =>
  new Promise((resolve) => {
    const child = spawn('pkill', ['-f', 'openclaw gateway'])
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })

const waitUntilStopped = async (timeoutMs = 5000): Promise<void> => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await getGatewayStatus()
    if (status === 'stopped') return
    await new Promise((r) => setTimeout(r, 500))
  }
  if (platform() !== 'win32') {
    await forceKillGateway()
    await new Promise((r) => setTimeout(r, 1000))
  }
}

const formatDate = (): string => {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

// ─── macOS: tar ───

const tarCreateMac = (destFile: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn('tar', ['-czf', destFile, '-C', homedir(), '.openclaw'])
    child.stdout.resume()
    child.stderr.resume()
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar create failed (exit ${code})`))
    })
    child.on('error', reject)
  })

const tarExtractMac = (srcFile: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', srcFile, '-C', homedir()])
    child.stdout.resume()
    child.stderr.resume()
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar extract failed (exit ${code})`))
    })
    child.on('error', reject)
  })

// ─── Windows: WSL 내 tar ───

const tarCreateWsl = (destFile: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn('wsl', [
      '-d', 'Ubuntu', '-u', 'root', '--',
      'tar', '-czf', '-', '-C', '/root', '.openclaw'
    ])
    const ws = createWriteStream(destFile)
    child.stdout.pipe(ws)
    child.stderr.resume()
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar failed (exit ${code})`))
    })
    child.on('error', reject)
    ws.on('error', reject)
  })

const tarExtractWsl = (srcFile: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const rs = createReadStream(srcFile)
    const child = spawn('wsl', [
      '-d', 'Ubuntu', '-u', 'root', '--',
      'tar', '-xzf', '-', '-C', '/root', '--no-same-owner',
      '--exclude=../*', '--exclude=*/../*'
    ])
    rs.pipe(child.stdin)
    child.stdout.resume()
    child.stderr.resume()
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar extract failed (exit ${code})`))
    })
    child.on('error', reject)
    rs.on('error', reject)
  })

// ─── Export ───

export const exportBackup = async (
  win: BrowserWindow
): Promise<{ success: boolean; error?: string }> => {
  const isWin = platform() === 'win32'

  // 소스 확인
  if (!isWin && !existsSync(openclawDir())) {
    return { success: false, error: '백업할 OpenClaw 설정이 없습니다.' }
  }
  if (isWin) {
    try {
      await runInWsl('test -d /root/.openclaw', 10000)
    } catch {
      return { success: false, error: '백업할 OpenClaw 설정이 없습니다.' }
    }
  }

  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'OpenClaw 백업 저장',
    defaultPath: `openclaw-backup-${formatDate()}.tar.gz`,
    filters: [{ name: 'Tar Archive', extensions: ['tar.gz'] }]
  })

  if (canceled || !filePath) return { success: false, error: '취소됨' }

  try {
    if (isWin) {
      await tarCreateWsl(filePath)
    } else {
      await tarCreateMac(filePath)
    }
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export const importBackup = async (
  win: BrowserWindow
): Promise<{ success: boolean; error?: string }> => {
  const isWin = platform() === 'win32'

  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'OpenClaw 백업 파일 선택',
    filters: [{ name: 'Tar Archive', extensions: ['tar.gz', 'gz'] }],
    properties: ['openFile']
  })

  if (canceled || filePaths.length === 0) return { success: false, error: '취소됨' }
  const backupFile = filePaths[0]

  try {
    try {
      await stopGateway()
    } catch {
      /* already stopped */
    }

    await waitUntilStopped()

    if (isWin) {
      await tarExtractWsl(backupFile)
    } else {
      await tarExtractMac(backupFile)
    }

    try {
      await startGateway()
    } catch {
      /* 사용자가 수동으로 시작 가능 */
    }

    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}
