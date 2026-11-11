import type { ReactNode } from 'react'
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

const HEADING = /^(#{1,6})\s+(.*)$/
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

/**
 * The assistant's Markdown as blocks: headings, tables, lists, rules and paragraphs.
 * Each line of text goes through `line` (bold, and "Sources: [1]" links).
 */
function Markdown({ text, line }: { text: string; line: (t: string, key: string) => ReactNode }) {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    const k = String(i)
    if (!l.trim()) { i++; continue }
    const h = HEADING.exec(l)
    if (h) {
      out.push(<div key={k} className={`md-h md-h${Math.min(h[1].length, 3)}`}>{line(h[2], k)}</div>)
      i++; continue
    }
    if (RULE.test(l)) { out.push(<hr key={k} className="md-hr" />); i++; continue }
    if (l.trim().startsWith('|') && TABLE_SEP.test(lines[i + 1] ?? '')) {
      const head = cells(l)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]))
      out.push(
        <div key={k} className="md-table">
          <table>
            <thead><tr>{head.map((c, j) => <th key={j}>{line(c, `${k}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, j) => <td key={j}>{line(r[j] ?? '', `${k}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    const list = BULLET.test(l) ? BULLET : NUMBERED.test(l) ? NUMBERED : null
    if (list) {
      const items: string[] = []
      while (i < lines.length && list.exec(lines[i])) items.push(list.exec(lines[i++])![1])
      const Tag = list === BULLET ? 'ul' : 'ol'
      out.push(<Tag key={k} className="md-list">{items.map((t, j) => <li key={j}>{line(t, `${k}i${j}`)}</li>)}</Tag>)
      continue
    }
    // a paragraph: the lines up to the next blank line or block
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !HEADING.test(lines[i]) && !RULE.test(lines[i])
      && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])
      && !(lines[i].trim().startsWith('|') && TABLE_SEP.test(lines[i + 1] ?? ''))) para.push(lines[i++])
    out.push(<p key={k} className="md-p">{para.map((t, j) => <span key={j}>{line(t, `${k}p${j}`)}{j < para.length - 1 && <br />}</span>)}</p>)
  }
  return <>{out}</>
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
          whiteSpace: isUser ? 'pre-wrap' : 'normal',
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
        {isUser
          ? <RichText text={message.content} />
          : <div className="md">
              <Markdown text={message.content} line={(t, key) => sources?.length
                ? <TextWithSources key={key} text={t} sources={sources} />
                : <RichText key={key} text={t} />} />
            </div>}
      </div>
    </div>
  )
}
