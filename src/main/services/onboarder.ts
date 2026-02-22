import { spawn } from 'child_process'
import { StringDecoder } from 'string_decoder'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { platform, homedir } from 'os'
import { join } from 'path'
import https from 'https'
import { BrowserWindow } from 'electron'

interface OnboardConfig {
  provider: 'anthropic' | 'google' | 'openai' | 'deepseek' | 'glm'
  apiKey: string
  telegramBotToken?: string
}

interface OnboardResult {
  botUsername?: string
}

const telegramGet = (url: string): Promise<{ ok: boolean; [k: string]: unknown }> =>
  new Promise((resolve) => {
    https
      .get(url, (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch {
            resolve({ ok: false })
          }
        })
      })
      .on('error', () => resolve({ ok: false }))
  })

const fetchBotUsername = async (token: string): Promise<string | undefined> => {
  const json = await telegramGet(`https://api.telegram.org/bot${token}/getMe`)
  return json.ok ? (json as unknown as { result: { username: string } }).result.username : undefined
}

// Telegram getUpdates 409 충돌 방지: 이전 long-poll이 해제될 때까지 대기
// getUpdates?timeout=0 호출로 확인하고, 409면 3초 후 재시도 (최대 5회)
const waitTelegramClear = async (token: string): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    const res = await telegramGet(
      `https://api.telegram.org/bot${token}/getUpdates?timeout=0&limit=1`
    )
    if (res.ok) return
    await new Promise((r) => setTimeout(r, 3000))
  }
}

import {
  getPathEnv,
  getNativeEnv,
  findBin,
  findNodeExe,
  findNpmCli,
  findOpenclawBin
} from './path-utils'

const createRunCmd = (): ((
  cmd: string,
  args: string[],
  onLog: (msg: string) => void
) => Promise<void>) => {
  const isNative = platform() === 'win32'

  return (cmd, args, onLog) =>
    new Promise((resolve, reject) => {
      let fullCmd = cmd
      let fullArgs = args
      let useShell: boolean = isNative

      // 네이티브 모드에서 npm 명령은 node.exe로 npm-cli.js 직접 실행
      if (isNative && cmd === 'npm') {
        const nodeExe = findNodeExe()
        const npmCli = findNpmCli()
        if (nodeExe && npmCli) {
          fullCmd = nodeExe
          fullArgs = [npmCli, ...args]
          useShell = false
        }
      }

      // 네이티브 모드에서 절대 경로 실행 시 shell: false (공백 포함 경로 안전 처리)
      if (isNative && cmd.includes('\\')) {
        useShell = false
      }

      const child = spawn(fullCmd, fullArgs, {
        env: isNative ? getNativeEnv() : getPathEnv(),
        shell: useShell
      })

      const outDecoder = new StringDecoder('utf8')
      const errDecoder = new StringDecoder('utf8')
      child.stdout.on('data', (d) => outDecoder.write(d).split('\n').filter(Boolean).forEach(onLog))
      child.stderr.on('data', (d) => errDecoder.write(d).split('\n').filter(Boolean).forEach(onLog))
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Command failed with exit code ${code}`))
      })
      child.on('error', reject)
    })
}

const nativeKillOpenclaw = (): Promise<void> =>
  new Promise((resolve) => {
    const ps =
      'Get-Process node -ErrorAction SilentlyContinue | ' +
      "Where-Object {$_.CommandLine -like '*openclaw*'} | Stop-Process -Force"
    const child = spawn('powershell', ['-Command', ps], { shell: true })
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })

export const runOnboard = async (
  win: BrowserWindow,
  config: OnboardConfig
): Promise<OnboardResult> => {
  const log = (msg: string): void => {
    win.webContents.send('install:progress', msg)
  }

  log('OpenClaw 초기 설정 시작...')

  const isWindows = platform() === 'win32'
  const isMac = platform() === 'darwin'
  const npm = isWindows ? 'npm' : findBin('npm')
  const ocDir = join(homedir(), '.openclaw')
  const fixPath = join(ocDir, 'ipv4-fix.js')
  const runCmd = createRunCmd()

  // Node.js 22 autoSelectFamily + IPv6 미지원 환경에서 Telegram API ETIMEDOUT 방지
  // onboard 전에 ipv4-fix.js를 생성하고 세션 레벨 NODE_OPTIONS를 설정하여
  // onboard가 시작하는 데몬 + self-restart 모두에 적용
  if (isMac) {
    if (!existsSync(ocDir)) mkdirSync(ocDir, { recursive: true })
    const fixContent = [
      "const dns = require('dns')",
      'const origLookup = dns.lookup',
      'dns.lookup = function (hostname, options, callback) {',
      "  if (typeof options === 'function') { callback = options; options = { family: 4 } }",
      "  else if (typeof options === 'number') { options = { family: 4 } }",
      '  else { options = Object.assign({}, options, { family: 4 }) }',
      '  return origLookup.call(this, hostname, options, callback)',
      '}'
    ].join('\n')
    writeFileSync(fixPath, fixContent + '\n')

    // 세션 레벨 NODE_OPTIONS 설정 (self-restart 포함 모든 node 프로세스에 적용)
    await new Promise<void>((resolve) => {
      const child = spawn('launchctl', ['setenv', 'NODE_OPTIONS', `--require=${fixPath}`])
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    })
  }

  // 기존 daemon 제거 + 프로세스 종료 + 깨진 설정 정리
  // 재설치 시 이전 제공사의 인증 정보가 남아 있으면 새 제공사로 전환 실패하므로
  // openclaw.json + 에이전트 인증 파일을 모두 삭제
  if (isWindows) {
    await nativeKillOpenclaw().catch(() => {})
    // 네이티브: macOS와 동일하게 fs 모듈 직접 사용
    const configFile = join(ocDir, 'openclaw.json')
    if (existsSync(configFile))
      try {
        unlinkSync(configFile)
      } catch {
        /* ignore */
      }
    const agentAuthDir = join(ocDir, 'agents', 'main', 'agent')
    for (const f of ['auth.json', 'auth-profiles.json']) {
      const p = join(agentAuthDir, f)
      if (existsSync(p))
        try {
          unlinkSync(p)
        } catch {
          /* ignore */
        }
    }
  } else {
    const plist = join(homedir(), 'Library', 'LaunchAgents', 'ai.openclaw.gateway.plist')
    if (existsSync(plist)) {
      await new Promise<void>((resolve) => {
        const child = spawn('launchctl', ['unload', plist])
        child.on('close', () => resolve())
        child.on('error', () => resolve())
      })
      try {
        unlinkSync(plist)
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => {
      const child = spawn('pkill', ['-9', '-f', 'openclaw'])
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    })
    // 이전 설정 + 에이전트 인증 정리 (제공사 전환 시 auth.json 꼬임 방지)
    const configFile = join(ocDir, 'openclaw.json')
    if (existsSync(configFile))
      try {
        unlinkSync(configFile)
      } catch {
        /* ignore */
      }
    const agentAuthDir = join(ocDir, 'agents', 'main', 'agent')
    for (const f of ['auth.json', 'auth-profiles.json']) {
      const p = join(agentAuthDir, f)
      if (existsSync(p))
        try {
          unlinkSync(p)
        } catch {
          /* ignore */
        }
    }
  }
  // 포트 해제 + Telegram long-poll 해제 대기
  await new Promise((resolve) => setTimeout(resolve, 5000))

  const authFlags: Record<OnboardConfig['provider'], string[]> = {
    anthropic: ['--auth-choice', 'apiKey', '--anthropic-api-key', config.apiKey],
    google: ['--auth-choice', 'gemini-api-key', '--gemini-api-key', config.apiKey],
    openai: ['--auth-choice', 'openai-api-key', '--openai-api-key', config.apiKey],
    deepseek: [
      '--auth-choice',
      'custom-api-key',
      '--custom-base-url',
      'https://api.deepseek.com/v1',
      '--custom-model-id',
      'deepseek-chat',
      '--custom-api-key',
      config.apiKey,
      '--custom-provider-id',
      'deepseek',
      '--custom-compatibility',
      'openai'
    ],
    glm: ['--auth-choice', 'zai-api-key', '--zai-api-key', config.apiKey]
  }

  // openclaw 직접 실행용 인자 (npm exec 래퍼 없이)
  const openclawArgs = [
    'onboard',
    '--non-interactive',
    '--accept-risk',
    '--mode',
    'local',
    ...authFlags[config.provider],
    '--gateway-port',
    '18789',
    '--gateway-bind',
    'loopback',
    // Windows: DoneStep에서 포그라운드 프로세스로 시작하므로 데몬 설치 불필요
    ...(isWindows ? [] : ['--install-daemon', '--daemon-runtime', 'node']),
    '--skip-skills'
  ]

  // npm exec 래퍼 인자 (macOS용)
  const onboardArgs = ['exec', '--', 'openclaw', ...openclawArgs]

  // 네이티브 모드: 설치된 openclaw 바이너리를 직접 실행하여 npx 캐시 재설치 우회
  const runOnboardNative = async (): Promise<void> => {
    const ocBin = findOpenclawBin()
    const nodeExe = findNodeExe()
    if (ocBin && nodeExe) {
      log(`openclaw 직접 실행: ${ocBin}`)
      try {
        await runCmd(nodeExe, [ocBin, ...openclawArgs], log)
        return
      } catch {
        log(`직접 실행 실패, npm exec fallback 시도...`)
      }
    }
    await runCmd(npm, onboardArgs, log)
  }

  try {
    if (isWindows) {
      await runOnboardNative()
    } else {
      await runCmd(npm, onboardArgs, log)
    }
  } catch (e) {
    // onboard가 gateway 연결 테스트(1006)로 실패해도
    // config 파일이 생성되었으면 계속 진행 (DoneStep에서 gateway를 별도 시작)
    const configPath = join(ocDir, 'openclaw.json')
    if (!existsSync(configPath)) throw e
    log('설정 파일 생성 완료 (gateway 검증 건너뜀)')
  }

  // onboard --install-daemon이 데몬을 시작하므로 즉시 중지
  // config 패치 중 자동 재시작으로 Telegram 409 충돌이 발생하는 것을 방지
  if (isMac) {
    const uid = process.getuid?.() ?? ''
    await new Promise<void>((resolve) => {
      const child = spawn('launchctl', ['bootout', `gui/${uid}/ai.openclaw.gateway`])
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    })
    await new Promise<void>((resolve) => {
      const child = spawn('pkill', ['-9', '-f', 'openclaw-gateway'])
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    })
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  // 제공사별 권장 모델 설정 (onboard 기본값 대신)
  const defaultModels: Record<OnboardConfig['provider'], string> = {
    anthropic: 'anthropic/claude-sonnet-4-6',
    google: 'google/gemini-3-flash',
    openai: 'openai/gpt-5.2',
    deepseek: 'deepseek/deepseek-chat',
    glm: 'zai/glm-5'
  }

  // custom provider는 contextWindow/maxTokens 기본값이 4096으로 잡혀 에이전트 실행 실패
  // 실제 모델 스펙에 맞게 패치
  const modelSpecs: Partial<
    Record<OnboardConfig['provider'], { contextWindow: number; maxTokens: number }>
  > = {
    deepseek: { contextWindow: 128000, maxTokens: 8192 }
  }

  const patchConfig = (ocConfig: Record<string, unknown>): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfg = ocConfig as any
    cfg.agents = cfg.agents ?? {}
    cfg.agents.defaults = cfg.agents.defaults ?? {}
    cfg.agents.defaults.model = {
      ...cfg.agents.defaults.model,
      primary: defaultModels[config.provider]
    }
    // custom provider의 contextWindow/maxTokens 패치
    const spec = modelSpecs[config.provider]
    if (spec && cfg.models?.providers) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const provider of Object.values(cfg.models.providers) as any[]) {
        if (Array.isArray(provider.models)) {
          for (const m of provider.models) {
            m.contextWindow = spec.contextWindow
            m.maxTokens = spec.maxTokens
          }
        }
      }
    }
  }

  const modelConfigPath = join(ocDir, 'openclaw.json')
  if (existsSync(modelConfigPath)) {
    const ocConfig = JSON.parse(readFileSync(modelConfigPath, 'utf-8'))
    patchConfig(ocConfig)
    writeFileSync(modelConfigPath, JSON.stringify(ocConfig, null, 2))
  }
  log('기본 설정 완료!')

  // plist에 IPv4 fix 적용 (ProgramArguments + EnvironmentVariables 둘 다)
  // ProgramArguments: 메인 프로세스에 --require 플래그 추가
  // EnvironmentVariables: NODE_OPTIONS로 자식 프로세스에도 ipv4-fix 전파
  if (isMac) {
    const plistAfter = join(homedir(), 'Library', 'LaunchAgents', 'ai.openclaw.gateway.plist')
    if (existsSync(plistAfter)) {
      let xml = readFileSync(plistAfter, 'utf-8')
      if (!xml.includes('ipv4-fix')) {
        xml = xml.replace(
          '<string>/usr/local/bin/node</string>',
          `<string>/usr/local/bin/node</string>\n      <string>--require=${fixPath}</string>`
        )
      }
      // NODE_OPTIONS 환경변수 추가 (자식 프로세스 IPv4 fix 전파)
      const nodeOpt = `--require=${fixPath}`
      if (!xml.includes('NODE_OPTIONS')) {
        xml = xml.replace(
          '</dict>\n  </dict>',
          `<key>NODE_OPTIONS</key>\n    <string>${nodeOpt}</string>\n    </dict>\n  </dict>`
        )
      }
      writeFileSync(plistAfter, xml)
    }
  }

  let botUsername: string | undefined

  if (config.telegramBotToken) {
    log('텔레그램 채널 추가 중...')
    const telegramChannel = {
      enabled: true,
      botToken: config.telegramBotToken,
      dmPolicy: 'open',
      allowFrom: ['*'],
      groups: { '*': { requireMention: true } }
    }

    const configPath = join(ocDir, 'openclaw.json')
    if (existsSync(configPath)) {
      const ocConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
      ocConfig.channels = { ...ocConfig.channels, telegram: telegramChannel }
      writeFileSync(configPath, JSON.stringify(ocConfig, null, 2))
      log('텔레그램 채널 추가 완료!')
    } else {
      log('OpenClaw 설정 파일을 찾을 수 없습니다')
    }

    botUsername = await fetchBotUsername(config.telegramBotToken)
  }

  // 모든 패치 완료 후 Telegram 409 충돌 방지: 이전 long-poll 해제 확인
  if (config.telegramBotToken) {
    log('Telegram 연결 상태 확인 중...')
    await waitTelegramClear(config.telegramBotToken)
  }

  // 모든 패치 완료 후 데몬 완전 재시작
  // Windows: DoneStep에서 포그라운드 프로세스로 시작하므로 여기서는 기존 프로세스만 정리
  if (isWindows) {
    log('기존 Gateway 정리 중...')
    await nativeKillOpenclaw().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 2000))
  } else if (isMac) {
    log('Gateway 시작 중...')
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'ai.openclaw.gateway.plist')
    const uid = process.getuid?.() ?? ''
    // 이미 onboard 직후에 중지했으므로 bootstrap만 실행
    if (existsSync(plistPath)) {
      await new Promise<void>((resolve) => {
        const child = spawn('launchctl', ['bootstrap', `gui/${uid}`, plistPath])
        child.on('close', () => resolve())
        child.on('error', () => resolve())
      })
    }
  }

  return { botUsername }
}
