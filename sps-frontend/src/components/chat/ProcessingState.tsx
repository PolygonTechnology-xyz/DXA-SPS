import { Square } from 'lucide-react'
import { Button } from '@/components/ui'

interface Props {
  progress?: string
  onStop?: () => void
}

export default function ProcessingState({ progress, onStop }: Props) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        background: 'rgba(247,248,250,.92)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}
    >
      <style>{`
        @keyframes processSpin { to { transform: rotate(360deg); } }
        @keyframes processDot { 0%,80%,100%{opacity:.2;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }
      `}</style>

      {/* spinner */}
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          border: '3px solid var(--accent-soft)',
          borderTopColor: 'var(--accent)',
          animation: 'processSpin .9s linear infinite',
        }}
      />

      <div style={{ textAlign: 'center', maxWidth: 340 }}>
        <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 16 }}>
          AI is working on it
        </p>
        {progress && (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, lineHeight: 1.5 }}>
            {progress}
          </p>
        )}
      </div>

      {onStop && (
        <Button icon={Square} onClick={onStop}>Stop</Button>
      )}
    </div>
  )
}
