import type { ChatMessage } from '@/api/session'
import { FileText, Globe } from 'lucide-react'
import { AssistantAvatar, RichText, sourceHref, onSourceClick, type CiteSource } from '@/components/ui'

interface Props {
  message: ChatMessage
  compact?: boolean
  /** Sources behind "Sources: [1] [2]" lines (the AS-IS review's questions) */
  sources?: CiteSource[]
}

const SOURCES_LINE = /^(?:Sources|সূত্র):\s*((?:\[\d+\]\s*)+)$/

/** Text with its "Sources: [1] [2]" lines shown as links: a document opens in the popup, a website in a new tab */
function TextWithSources({ text, sources }: { text: string; sources: CiteSource[] }) {
  const byN = new Map(sources.map((s) => [s.n, s]))
  return (
    <>
      {text.split('\n').map((line, i, all) => {
        const m = SOURCES_LINE.exec(line.trim())
        const nl = i < all.length - 1 ? '\n' : ''
        if (!m) return <span key={i}><RichText text={line} />{nl}</span>
        const refs = [...m[1].matchAll(/\[(\d+)\]/g)].map((x) => byN.get(Number(x[1]))).filter((x): x is CiteSource => !!x)
        return (
          <span key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 6px', margin: '3px 0 4px', whiteSpace: 'normal' }}>
            {refs.map((s) => {
              const Icon = s.kind === 'doc' ? FileText : Globe
              return (
                <a
                  key={s.n}
                  href={sourceHref(s)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => onSourceClick(e, s)}
                  title={s.title}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%',
                    padding: '2px 8px', borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface)',
                    color: 'var(--accent)', fontSize: 12.5, textDecoration: 'none',
                  }}
                >
                  <Icon size={12} strokeWidth={2} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                </a>
              )
            })}
          </span>
        )
      })}
    </>
  )
}

export default function ChatMessageComp({ message, compact, sources }: Props) {
  const isUser = message.role === 'user'

  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        marginBottom: compact ? 14 : 20,
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
      }}
    >
      {!isUser && <AssistantAvatar />}
      <div
        style={{
          maxWidth: isUser ? '85%' : 'calc(100% - 38px)',
          whiteSpace: 'pre-wrap',
          fontSize: 14,
          lineHeight: 1.6,
          padding: '11px 14px',
          borderRadius: 12,
          overflowWrap: 'anywhere',
          ...(isUser
            ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderTopRightRadius: 4 }
            : { background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--ink-2)', borderTopLeftRadius: 4 }),
        }}
      >
        {sources?.length ? <TextWithSources text={message.content} sources={sources} /> : <RichText text={message.content} />}
      </div>
    </div>
  )
}
