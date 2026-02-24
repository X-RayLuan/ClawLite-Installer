import { useState, useEffect, useCallback } from 'react'
import AgentCard from '../components/AgentCard'
import Button from '../components/Button'

type AgentStatus = 'not_purchased' | 'activated' | 'installed'
type View = 'list' | 'detail' | 'activating'

interface AgentMeta {
  id: string
  name: string
  description: string
  version: string
  price: number
  features: string[]
  checkoutUrl: string
}

const BackButton = ({
  onClick,
  label
}: {
  onClick: () => void
  label: string
}): React.JSX.Element => (
  <button
    onClick={onClick}
    className="flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text transition-colors"
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
    {label}
  </button>
)

export default function AgentStoreStep({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [view, setView] = useState<View>('list')
  const [agents, setAgents] = useState<AgentMeta[]>([])
  const [selected, setSelected] = useState<AgentMeta | null>(null)
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>({})
  const [licenseKey, setLicenseKey] = useState('')
  const [activating, setActivating] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')

  const loadStatuses = useCallback(async (agentList: AgentMeta[]): Promise<void> => {
    const entries = await Promise.all(
      agentList.map(async (a) => {
        const s = await window.electronAPI.agentStore.status(a.id)
        return [a.id, s] as const
      })
    )
    setStatuses(Object.fromEntries(entries))
  }, [])

  useEffect(() => {
    window.electronAPI.agentStore.list().then((list) => {
      setAgents(list)
      loadStatuses(list)
    })
  }, [loadStatuses])

  const handleActivate = async (): Promise<void> => {
    if (!selected || !licenseKey.trim()) return
    setActivating(true)
    setError('')
    const result = await window.electronAPI.agentStore.activate(selected.id, licenseKey.trim())
    setActivating(false)
    if (result.success) {
      setStatuses((prev) => ({ ...prev, [selected.id]: 'activated' }))
      setView('detail')
      setLicenseKey('')
    } else {
      setError(result.error || '활성화에 실패했습니다')
    }
  }

  const handleInstall = async (): Promise<void> => {
    if (!selected) return
    setInstalling(true)
    setError('')
    const result = await window.electronAPI.agentStore.install(selected.id)
    setInstalling(false)
    if (result.success) {
      setStatuses((prev) => ({ ...prev, [selected.id]: 'installed' }))
    } else {
      setError(result.error || '설치에 실패했습니다')
    }
  }

  const openDetail = (agent: AgentMeta): void => {
    setSelected(agent)
    setError('')
    setView('detail')
  }

  const status = selected ? (statuses[selected.id] ?? 'not_purchased') : 'not_purchased'

  // List 뷰
  if (view === 'list') {
    return (
      <div className="flex-1 flex flex-col px-8 pt-12 pb-6 gap-5 overflow-y-auto">
        <div className="flex items-center gap-3">
          <BackButton onClick={onBack} label="뒤로" />
          <h2 className="text-lg font-black">에이전트 스토어</h2>
        </div>

        <p className="text-xs text-text-muted -mt-2">AI 에이전트를 설치하여 생산성을 높여보세요</p>

        <div className="flex flex-col gap-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              name={agent.name}
              description={agent.description}
              price={agent.price}
              status={statuses[agent.id] ?? 'not_purchased'}
              onClick={() => openDetail(agent)}
            />
          ))}

          {/* Coming Soon 카드 */}
          <AgentCard
            name="SNS 콘텐츠 에이전트"
            description="Instagram/Twitter 콘텐츠 자동 생성"
            price={0}
            status="not_purchased"
            comingSoon
          />
        </div>
      </div>
    )
  }

  // Detail 뷰
  if (view === 'detail' && selected) {
    return (
      <div className="flex-1 flex flex-col px-8 pt-12 pb-6 gap-4 overflow-y-auto">
        <div className="flex items-center gap-3">
          <BackButton
            onClick={() => {
              setView('list')
              setError('')
            }}
            label="목록"
          />
          <h2 className="text-lg font-black flex-1 truncate">{selected.name}</h2>
          <span className="text-[10px] text-text-muted font-medium">v{selected.version}</span>
        </div>

        <p className="text-sm text-text-muted leading-relaxed">{selected.description}</p>

        <div className="flex flex-col gap-1.5">
          {selected.features.map((f, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-success text-xs mt-0.5 shrink-0">✓</span>
              <span className="text-xs text-text/90">{f}</span>
            </div>
          ))}
        </div>

        <div className="glass-card px-5 py-3 flex items-center justify-between">
          <div>
            <p className="text-lg font-black text-primary">₩{selected.price.toLocaleString()}</p>
            <p className="text-[10px] text-text-muted">1회 구매, 영구 사용</p>
          </div>
          {status === 'not_purchased' && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => window.open(selected.checkoutUrl, '_blank')}
            >
              구매하기
            </Button>
          )}
          {status === 'activated' && (
            <Button variant="primary" size="sm" loading={installing} onClick={handleInstall}>
              설치하기
            </Button>
          )}
          {status === 'installed' && (
            <span className="text-xs font-bold text-success">✓ 설치 완료</span>
          )}
        </div>

        {error && <p className="text-xs text-error text-center">{error}</p>}

        {status !== 'installed' && (
          <div className="mt-2">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px bg-glass-border" />
              <span className="text-[10px] text-text-muted font-medium">이미 구매하셨나요?</span>
              <div className="flex-1 h-px bg-glass-border" />
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
                placeholder="라이선스 키 입력"
                className="flex-1 px-4 py-2.5 text-sm bg-white/5 border border-glass-border rounded-xl focus:border-primary/50 focus:outline-none transition-colors placeholder:text-text-muted/40"
              />
              <Button
                variant="secondary"
                size="sm"
                loading={activating}
                disabled={!licenseKey.trim()}
                onClick={handleActivate}
              >
                활성화
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return <div />
}
