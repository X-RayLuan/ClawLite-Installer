import { type CSSProperties } from 'react'

type LogoState = 'idle' | 'loading' | 'success' | 'error'

const stateStyles: Record<LogoState, CSSProperties> = {
  idle: {},
  loading: { animation: 'lobster-bounce 0.8s ease-in-out infinite' },
  success: { filter: 'drop-shadow(0 0 16px rgba(52, 211, 153, 0.5))' },
  error: { filter: 'drop-shadow(0 0 16px rgba(251, 113, 133, 0.5))', animation: 'lobster-shake 0.5s ease-in-out' }
}

export default function LobsterLogo({
  state = 'idle',
  size = 120
}: {
  state?: LogoState
  size?: number
}): React.JSX.Element {
  return (
    <>
      <style>{`
        @keyframes lobster-bounce {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          30% { transform: translateY(-6px) rotate(-2deg); }
          70% { transform: translateY(-6px) rotate(2deg); }
        }
        @keyframes lobster-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-3px) rotate(-1deg); }
          40% { transform: translateX(3px) rotate(1deg); }
          60% { transform: translateX(-2px); }
          80% { transform: translateX(2px); }
        }
      `}</style>
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ transition: 'filter 0.4s, transform 0.4s', ...stateStyles[state] }}
      >
        <defs>
          <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#c2410c" />
          </linearGradient>
        </defs>
        {/* antennae */}
        <path d="M45 15 Q36 4 29 7" stroke="#fb923c" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <path d="M75 15 Q84 4 91 7" stroke="#fb923c" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        {/* body */}
        <path d="M60 12 C32 12 16 35 16 55 C16 74 30 93 44 98 L44 108 L53 108 L53 98 C56 99 60 100 60 100 C60 100 64 99 67 98 L67 108 L76 108 L76 98 C90 93 104 74 104 55 C104 35 88 12 60 12Z" fill="url(#g)" />
        {/* left claw */}
        <path d="M20 44 C6 39 1 49 5 58 C9 67 19 63 24 54 C27 48 24 44 20 44Z" fill="url(#g)" />
        {/* right claw */}
        <path d="M100 44 C114 39 119 49 115 58 C111 67 101 63 96 54 C93 48 96 44 100 44Z" fill="url(#g)" />
        {/* eyes */}
        <circle cx="45" cy="40" r="7" fill="#050810" />
        <circle cx="75" cy="40" r="7" fill="#050810" />
        <circle cx="47" cy="38" r="3" fill="#34d4b0" />
        <circle cx="77" cy="38" r="3" fill="#34d4b0" />
      </svg>
    </>
  )
}
