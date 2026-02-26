import { spawn } from 'child_process'
import { existsSync, createWriteStream, createReadStream, readFileSync, writeFileSync } from 'fs'
import { homedir, platform } from 'os'
import { join } from 'path'
import https from 'https'
import { BrowserWindow, dialog } from 'electron'
import { stopGateway, startGateway, waitUntilStopped } from './gateway'
import { runInWsl, readWslFile } from './wsl-utils'

const openclawDir = (): string => join(homedir(), '.openclaw')

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
    const child = spawn('tar', [
      '-xzf',
      srcFile,
      '-C',
      homedir(),
      '--no-same-owner',
      '--exclude=../*',
      '--exclude=*/../*'
    ])
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
      '-d',
      'Ubuntu',
      '-u',
      'root',
      '--',
      'tar',
      '-czf',
      '-',
      '-C',
      '/root',
      '.openclaw'
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
      '-d',
      'Ubuntu',
      '-u',
      'root',
      '--',
      'tar',
      '-xzf',
      '-',
      '-C',
      '/root',
      '--no-same-owner',
      '--exclude=../*',
      '--exclude=*/../*'
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

// ─── IPv4 fix (macOS) ───

const ensureIpv4Fix = async (): Promise<void> => {
  if (platform() !== 'darwin') return
  const fixPath = join(homedir(), '.openclaw', 'ipv4-fix.js')
  if (!existsSync(fixPath)) return
  // 현재 세션 launchd 환경에 NODE_OPTIONS 설정
  await new Promise<void>((r) => {
    const child = spawn('launchctl', ['setenv', 'NODE_OPTIONS', `--require=${fixPath}`])
    child.on('close', () => r())
    child.on('error', () => r())
  })
  // plist에 NODE_OPTIONS 영구 패치
  const plist = join(homedir(), 'Library', 'LaunchAgents', 'ai.openclaw.gateway.plist')
  if (!existsSync(plist)) return
  let xml = readFileSync(plist, 'utf-8')
  if (xml.includes('NODE_OPTIONS')) return
  xml = xml.replace(
    '</dict>\n  </dict>',
    `<key>NODE_OPTIONS</key>\n    <string>--require=${fixPath}</string>\n    </dict>\n  </dict>`
  )
  writeFileSync(plist, xml)
}

// ─── Telegram long-poll 정리 ───

const clearTelegramPoll = async (): Promise<void> => {
  const isWin = platform() === 'win32'
  let raw: string | undefined
  try {
    if (isWin) {
      raw = await readWslFile('/root/.openclaw/openclaw.json')
    } else {
      const p = join(homedir(), '.openclaw', 'openclaw.json')
      if (existsSync(p)) raw = readFileSync(p, 'utf-8')
    }
  } catch {
    return
  }
  if (!raw) return

  let token: string | undefined
  try {
    token = JSON.parse(raw).channels?.telegram?.botToken
  } catch {
    return
  }
  if (!token) return

  for (let i = 0; i < 5; i++) {
    const ok = await new Promise<boolean>((resolve) => {
      https
        .get(`https://api.telegram.org/bot${token}/getUpdates?timeout=0&limit=1`, (res) => {
          let d = ''
          res.on('data', (c) => (d += c))
          res.on('end', () => {
            try {
              resolve(JSON.parse(d).ok === true)
            } catch {
              resolve(false)
            }
          })
        })
        .on('error', () => resolve(false))
    })
    if (ok) return
    await new Promise((r) => setTimeout(r, 3000))
  }
}

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

    // IPv4 fix 적용 (launchctl setenv) + Telegram long-poll 409 충돌 방지
    await ensureIpv4Fix()
    await clearTelegramPoll()

    try {
      await startGateway()
    } catch {
      /* 사용자가 수동으로 시작 가능 */
    }

    // Gateway install이 plist를 재생성했을 수 있으므로 다시 패치
    await ensureIpv4Fix()

    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}
