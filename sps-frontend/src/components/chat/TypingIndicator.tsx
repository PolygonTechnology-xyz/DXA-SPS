import { AssistantAvatar } from '@/components/ui'

export default function TypingIndicator({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'flex-start' }}>
      <style>{`
        @keyframes typingDot {
          0%, 80%, 100% { opacity: .25 }
          40% { opacity: 1 }
        }
      `}</style>
      <AssistantAvatar />
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderRadius: 12, borderTopLeftRadius: 4,
        background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--muted)', fontSize: 13,
      }}>
        <span>
          {[0, 150, 300].map((delay, i) => (
            <span
              key={i}
              style={{
                display: 'inline-block', width: 6, height: 6, marginRight: 3, borderRadius: '50%',
                background: 'var(--muted)', animation: `typingDot 1s ${delay}ms infinite`,
              }}
            />
          ))}
        </span>
        {label}
      </div>
    </div>
  )
}
