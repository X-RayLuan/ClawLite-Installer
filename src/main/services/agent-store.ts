import { app } from 'electron'
import { platform, homedir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'fs'
import { runInWsl } from './wsl-utils'

export interface AgentMeta {
  id: string
  name: string
  description: string
  version: string
  price: number
  features: string[]
  checkoutUrl: string
}

interface AgentLicense {
  licenseKey: string
  activatedAt: string
  installed: boolean
}

interface AgentLicenses {
  [agentId: string]: AgentLicense
}

export type AgentStatus = 'not_purchased' | 'activated' | 'installed'

const AGENTS: AgentMeta[] = [
  {
    id: 'naver-blogger',
    name: '네이버 블로거 에이전트',
    description: '네이버 블로그 SEO에 최적화된 자동 글 작성 에이전트입니다.',
    version: '1.0.0',
    price: 19900,
    features: [
      '웹 검색 기반 키워드 리서치',
      '네이버 상위 글 경쟁 분석',
      'C-Rank/D.I.A. 최적화 글 작성',
      '5가지 글 유형 템플릿',
      '100점 SEO 채점 시스템',
      '시리즈 기획 + 내부 링크 전략'
    ],
    checkoutUrl: 'https://easyclaw.lemonsqueezy.com/buy/naver-blogger'
  }
]

const getLicensesPath = (): string => join(app.getPath('userData'), 'agent-licenses.json')

const loadLicenses = (): AgentLicenses => {
  try {
    const path = getLicensesPath()
    if (!existsSync(path)) return {}
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return {}
  }
}

const saveLicenses = (licenses: AgentLicenses): void => {
  writeFileSync(getLicensesPath(), JSON.stringify(licenses, null, 2))
}

export const getAgentList = (): AgentMeta[] => AGENTS

export const getAgentStatus = (agentId: string): AgentStatus => {
  const licenses = loadLicenses()
  const license = licenses[agentId]
  if (!license) return 'not_purchased'
  return license.installed ? 'installed' : 'activated'
}

export const activateAgent = async (
  agentId: string,
  licenseKey: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const resp = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: licenseKey })
    })

    if (!resp.ok) return { success: false, error: '라이선스 서버에 연결할 수 없습니다' }

    const data = await resp.json()
    if (!data.valid)
      return { success: false, error: data.error || '유효하지 않은 라이선스 키입니다' }

    const licenses = loadLicenses()
    licenses[agentId] = {
      licenseKey,
      activatedAt: new Date().toISOString(),
      installed: false
    }
    saveLicenses(licenses)

    return { success: true }
  } catch {
    return { success: false, error: '라이선스 검증 중 오류가 발생했습니다' }
  }
}

export const installAgent = async (
  agentId: string
): Promise<{ success: boolean; error?: string }> => {
  const licenses = loadLicenses()
  if (!licenses[agentId]) return { success: false, error: '먼저 라이선스를 활성화해주세요' }

  const srcDir = join(process.resourcesPath, 'agents', agentId)
  if (!existsSync(srcDir)) return { success: false, error: '에이전트 파일을 찾을 수 없습니다' }

  try {
    if (platform() === 'win32') {
      // WSL: /root/.openclaw/skills/{agent-id}/
      const destDir = `/root/.openclaw/skills/${agentId}`
      await runInWsl(`mkdir -p '${destDir}'`)

      // WSL 경로로 복사: Windows 경로를 wslpath로 변환
      const winPath = srcDir.replace(/\\/g, '/')
      await runInWsl(`cp -r "$(wslpath '${winPath}')"/* '${destDir}/'`, 60000)
    } else {
      // macOS: ~/.openclaw/skills/{agent-id}/
      const destDir = join(homedir(), '.openclaw', 'skills', agentId)
      mkdirSync(destDir, { recursive: true })
      cpSync(srcDir, destDir, { recursive: true })
    }

    licenses[agentId].installed = true
    saveLicenses(licenses)

    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}
