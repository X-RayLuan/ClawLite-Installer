type AgentStatus = 'not_purchased' | 'activated' | 'installed'

interface AgentCardProps {
  name: string
  description: string
  price: number
  status: AgentStatus
  comingSoon?: boolean
  onClick?: () => void
}

const statusBadge: Record<AgentStatus, { label: string; cls: string } | null> = {
  not_purchased: null,
  activated: { label: '활성화됨', cls: 'text-warning' },
  installed: { label: '설치됨', cls: 'text-success' }
}

export default function AgentCard({
  name,
  description,
  price,
  status,
  comingSoon = false,
  onClick
}: AgentCardProps): React.JSX.Element {
  const badge = statusBadge[status]

  return (
    <button
      onClick={onClick}
      disabled={comingSoon}
      className="glass-card w-full flex items-center gap-4 px-5 py-4 text-left cursor-pointer hover:border-primary/40 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-glass-border"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold truncate">{name}</p>
          {badge && (
            <span className={`text-[10px] font-bold ${badge.cls}`}>
              {status === 'installed' && '✓ '}
              {badge.label}
            </span>
          )}
        </div>
        <p className="text-[11px] text-text-muted mt-0.5 truncate">{description}</p>
        <p className="text-xs font-bold text-primary mt-1">
          {comingSoon ? 'Coming Soon' : `₩${price.toLocaleString()}`}
        </p>
      </div>
      {!comingSoon && (
        <svg
          className="shrink-0 text-text-muted"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </button>
  )
}
