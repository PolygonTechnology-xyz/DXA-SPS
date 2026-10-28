import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, X, SkipForward, Globe, Sparkles, ChevronRight, ChevronDown, CircleCheck, HelpCircle, History } from 'lucide-react'
import { projectsApi, type Project, type StepSource } from '@/api/projects'
import { AssistantAvatar, Button, Spinner, sourceHref } from '@/components/ui'
import { openReference } from '@/stores/reference'
import { useNavigation } from '@/stores/navigation'
import { describeFinding, findingText } from '@/lib/asisReview'

export type TopicKey = 'step' | 'pain_points' | 'legal_basis' | 'digital_status'
export interface ReviewTopic {
  key: TopicKey
  finding_ids: string[]
  questions: Array<{ field: string; step_number: number; question: string; found: string; refs: number[] }>
}

const TOPIC_LABEL: Record<TopicKey, string> = {
  step: 'Steps from the web',
  pain_points: 'Pain points',
  legal_basis: 'Law',
  digital_status: 'Digitalization',
}
const TOPIC_INTRO: Record<TopicKey, string> = {
  step: 'These steps were found on the web, not in your files. Should they be part of the AS-IS?',
  pain_points: 'First, the pain points — what goes wrong for citizens or staff at each step.',
  legal_basis: 'Next, the law — the Government Order, regulation or judgement behind each step.',
  digital_status: 'Last, digitalization — how far each step is already online.',
}

/** Answered questions are remembered per card in this browser (an answer is also a chat message) */
const answeredKey = (cardId: string) => `sps.review-answered.${cardId}`
function readAnswered(cardId: string): string[] {
  try { return JSON.parse(localStorage.getItem(answeredKey(cardId)) ?? '[]') } catch { return [] }
}

/**
 * The AS-IS review in the chat rail, one topic at a time: pain points, then law, then
 * digitalization. A topic is done when its items are decided and its questions answered
 * (or skipped); then the next one opens.
 */
const when = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export default function ReviewSteps({ cardId, latest, createdAt, projectId, project, topics, sources, busy, onAnswer }: {
  cardId: string
  /** the newest review card: it reports what is open and is the one brought into view */
  latest: boolean
  createdAt?: string
  projectId: string
  project: Project | undefined
  topics: ReviewTopic[]
  sources?: StepSource[]
  /** the assistant is replying — answers wait */
  busy: boolean
  /** an answer to a question is sent to the assistant as a chat message */
  onAnswer: (text: string) => void
}) {
  const qc = useQueryClient()
  const [deciding, setDeciding] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [answered, setAnswered] = useState<string[]>(() => readAnswered(cardId))
  const findings = project?.asis_findings ?? []
  const steps = project?.asis_steps ?? []
  const qid = (t: ReviewTopic, i: number) => `${t.key}:${i}`

  const doneOf = (t: ReviewTopic) =>
    t.finding_ids.every((id) => findings.find((f) => f.id === id)?.status !== 'pending')
    && t.questions.every((_, i) => answered.includes(qid(t, i)))
  const firstOpen = useMemo(() => {
    const i = topics.findIndex((t) => !doneOf(t))
    return i === -1 ? topics.length : i
  }, [topics, findings, answered]) // eslint-disable-line react-hooks/exhaustive-deps

  // the open topic follows the answers; the user may look back at an earlier one
  const [current, setCurrent] = useState(firstOpen)
  useEffect(() => { setCurrent(firstOpen) }, [firstOpen])

  // what is still open: the AS-IS page and the Assistant button point the user here
  const openCount = topics.reduce((n, t) =>
    n + t.finding_ids.filter((id) => findings.find((f) => f.id === id)?.status === 'pending').length
      + t.questions.filter((_, i) => !answered.includes(qid(t, i))).length, 0)
  const openTopic = firstOpen < topics.length ? TOPIC_LABEL[topics[firstOpen].key] : ''
  useEffect(() => {
    if (!latest) return
    useNavigation.getState().setReviewWaiting(openCount ? { projectId, open: openCount, topic: openTopic } : null)
  }, [latest, projectId, openCount, openTopic])

  // "Answer now" on the page (or the card arriving with open items): scroll here and glow
  const boxRef = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState(false)
  const focusRequest = useNavigation((s) => s.reviewFocusRequest)
  const mountedAt = useRef(focusRequest)
  useEffect(() => {
    if (!latest || (!openCount && focusRequest === mountedAt.current)) return
    // after the rail's own scroll to the newest message
    const t = window.setTimeout(() => {
      boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setFlash(true)
    }, 250)
    const off = window.setTimeout(() => setFlash(false), 3500)
    return () => { clearTimeout(t); clearTimeout(off) }
  }, [latest, focusRequest]) // eslint-disable-line react-hooks/exhaustive-deps

  function markAnswered(ids: string[]) {
    setAnswered((prev) => {
      const next = [...new Set([...prev, ...ids])]
      try { localStorage.setItem(answeredKey(cardId), JSON.stringify(next)) } catch { /* private window */ }
      return next
    })
  }

  // A topic's answers go to the assistant together, in one message, once the topic is done —
  // not one chat turn (and one reply) per question. "Don't know" sends nothing.
  const [drafts, setDrafts] = useState<Record<string, { step: number; text: string }>>({})
  useEffect(() => {
    if (busy) return
    for (const t of topics) {
      const ids = t.questions.map((_, i) => qid(t, i))
      const ready = ids.filter((id) => drafts[id])
      if (!ready.length || !ids.every((id) => answered.includes(id))) continue
      const label = TOPIC_LABEL[t.key]
      onAnswer(ready.length === 1
        ? `Step ${drafts[ready[0]].step} — ${label}: ${drafts[ready[0]].text}`
        : `My answers for ${label.toLowerCase()}:\n${ready.map((id) => `- Step ${drafts[id].step}: ${drafts[id].text}`).join('\n')}`)
      setDrafts((d) => { const n = { ...d }; ready.forEach((id) => delete n[id]); return n })
      return   // one message at a time: the next one waits for this reply
    }
  }, [drafts, answered, busy]) // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(ids: string[], decision: 'accept' | 'reject' | 'skip') {
    if (!ids.length) return
    setDeciding(ids.length > 1 ? 'all' : ids[0])
    setError('')
    try {
      const r = await projectsApi.decideFindings(projectId, ids.map((id) => ({ id, decision })))
      qc.setQueryData(['project', projectId], (old: Project | undefined) =>
        old ? { ...old, asis_steps: r.asis_steps, asis_findings: r.asis_findings } : old)
    } catch {
      setError('Could not save your answer. Please try again.')
    } finally {
      setDeciding(null)
    }
  }

  // an earlier review stays in the history, folded away
  const [showOld, setShowOld] = useState(false)

  if (!topics.length) return null
  if (!latest && !showOld) {
    const total = topics.reduce((n, t) => n + t.finding_ids.length + t.questions.length, 0)
    return (
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'flex-start' }}>
        <AssistantAvatar />
        <button type="button" className="rv-old" onClick={() => setShowOld(true)}>
          <History size={14} />
          <span style={{ flex: 1, minWidth: 0 }}>Earlier review · {total} item{total === 1 ? '' : 's'}{createdAt ? ` · ${when(createdAt)}` : ''}</span>
          <span className="rv-old__show">Show <ChevronDown size={13} /></span>
        </button>
      </div>
    )
  }
  const allDone = firstOpen >= topics.length
  const topic = topics[Math.min(current, topics.length - 1)]
  const items = topic.finding_ids.map((id) => findings.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f)
  const sourceMap = new Map((sources ?? []).map((s) => [s.n, s]))

  return (
    <>
    {latest && openCount > 0 && <div className="rv-divider"><span>New questions</span></div>}
    <div ref={boxRef} style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'flex-start', scrollMarginTop: 12 }}>
      <AssistantAvatar />
      <div className={`rv-card${latest ? (openCount ? ' rv-card--new' : '') : ' rv-card--old'}${flash ? ' rv-card--flash' : ''}`}>
        <div className="rv-head">
          <strong>AS-IS review</strong>
          {latest
            ? openCount > 0
              ? <span className="rv-badge rv-badge--new"><span className="rv-waiting__dot" /> {openCount} waiting</span>
              : <span className="rv-badge rv-badge--ok"><Check size={11} strokeWidth={3} /> Complete</span>
            : <span className="rv-badge">Earlier</span>}
          <span style={{ flex: 1 }} />
          {createdAt && <time className="rv-time" dateTime={createdAt}>{when(createdAt)}</time>}
          {!latest && <button type="button" className="rv-old__hide" onClick={() => setShowOld(false)}>Hide</button>}
        </div>
        {/* the topics, in order */}
        <div className="rv-steps">
          {topics.map((t, i) => {
            const done = doneOf(t)
            return (
              <button key={t.key} type="button" onClick={() => setCurrent(i)}
                className={`rv-step${i === current && !allDone ? ' rv-step--on' : ''}${done ? ' rv-step--done' : ''}`}
                disabled={i > firstOpen}
                title={i > firstOpen ? 'Opens after the topic before it' : undefined}>
                <span className="rv-step__n">{done ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
                {TOPIC_LABEL[t.key]}
              </button>
            )
          })}
        </div>

        {allDone && current >= topics.length ? (
          <div className="rv-done"><CircleCheck size={16} /> All review items are answered. You can approve the AS-IS when it looks right.</div>
        ) : (
          <>
            <div className="rv-intro">{TOPIC_INTRO[topic.key]}</div>

            {items.length > 0 && (
              <ol className="rv-list">
                {items.map((f) => {
                  const confirm = f.origin === 'unsourced'
                  return (
                    <li key={f.id} className={`rv-item${f.status === 'pending' ? ' rv-item--open' : ' rv-item--done'}`}>
                      <div className="rv-item__where">{describeFinding(f, steps)}</div>
                      <div className="rv-item__text">{findingText(f)}</div>
                      <div className="rv-item__src">
                        {f.origin === 'web' && f.sources.length
                          ? f.sources.map((s) => (
                            <a key={s.id} href={sourceHref(s)} target="_blank" rel="noreferrer" onClick={(e) => { if (s.kind === 'doc') { e.preventDefault(); openReference(s) } }}>
                              <Globe size={12} /> {s.title}
                            </a>
                          ))
                          : <span><Sparkles size={12} /> No source found — answer only if you know</span>}
                      </div>
                      <div className="rv-item__actions">
                        {f.status === 'pending' ? (
                          confirm ? <>
                            <Button size="sm" variant="primary" icon={Check} disabled={!!deciding} onClick={() => decide([f.id], 'accept')}>Yes</Button>
                            <Button size="sm" icon={X} disabled={!!deciding} onClick={() => decide([f.id], 'reject')}>No</Button>
                            <Button size="sm" variant="ghost" icon={SkipForward} disabled={!!deciding} onClick={() => decide([f.id], 'skip')}>Skip</Button>
                          </> : <>
                            <Button size="sm" variant="primary" icon={Check} disabled={!!deciding} onClick={() => decide([f.id], 'accept')}>Use</Button>
                            <Button size="sm" variant="ghost" icon={X} disabled={!!deciding} onClick={() => decide([f.id], 'reject')}>Don't use</Button>
                          </>
                        ) : (
                          <span className={`rv-status${f.status === 'accepted' ? ' rv-status--ok' : ''}`}>
                            {f.status === 'accepted' ? (confirm ? '✓ Confirmed by you' : '✓ Used') : f.status === 'rejected' ? (confirm ? '✕ Not correct — left empty' : '✕ Not used') : f.status === 'skipped' ? '» Skipped' : 'Step removed'}
                          </span>
                        )}
                        {deciding === f.id && <Spinner size={13} />}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}

            {topic.questions.map((q, i) => ({ q, i }))
              .sort((a, b) => Number(answered.includes(qid(topic, a.i))) - Number(answered.includes(qid(topic, b.i))))
              .map(({ q, i }) => (
              <Question key={qid(topic, i)} q={q} sourceMap={sourceMap} label={TOPIC_LABEL[topic.key]}
                answered={answered.includes(qid(topic, i))}
                onAnswer={(text) => { setDrafts((d) => ({ ...d, [qid(topic, i)]: { step: q.step_number, text } })); markAnswered([qid(topic, i)]) }}
                onSkip={() => markAnswered([qid(topic, i)])} />
            ))}

            <div className="rv-foot">
              {items.filter((f) => f.status === 'pending').length > 1 && (
                <>
                  <Button size="sm" disabled={!!deciding} onClick={() => decide(items.filter((f) => f.status === 'pending').map((f) => f.id), 'accept')}>
                    {items.every((f) => f.origin === 'unsourced') ? 'Yes to all' : 'Use all'}
                  </Button>
                  {deciding === 'all' && <Spinner size={13} />}
                </>
              )}
              {topic.questions.some((_, i) => drafts[qid(topic, i)]) && (
                <span className="rv-hint">Answers are sent together when this topic is done</span>
              )}
              <span style={{ flex: 1 }} />
              {current < topics.length - 1 && (
                <Button size="sm" variant="ghost" iconRight={ChevronRight} onClick={() => {
                  // moving on leaves the open questions of this topic unanswered
                  markAnswered(topic.questions.map((_, i) => qid(topic, i)))
                  if (doneOf(topic) || topic.finding_ids.every((id) => findings.find((f) => f.id === id)?.status !== 'pending')) setCurrent(current + 1)
                }} disabled={topic.finding_ids.some((id) => findings.find((f) => f.id === id)?.status === 'pending')}
                  title="Answer the items above first; open questions can be skipped">
                  Next: {TOPIC_LABEL[topics[current + 1].key]}
                </Button>
              )}
            </div>
          </>
        )}
        {error && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
      </div>
    </div>
    </>
  )
}

function Question({ q, sourceMap, label, answered, onAnswer, onSkip }: {
  q: ReviewTopic['questions'][number]
  sourceMap: Map<number, StepSource>
  label: string
  answered: boolean
  onAnswer: (text: string) => void
  onSkip: () => void
}) {
  const [text, setText] = useState('')
  if (answered) {
    return (
      <div className="rv-q rv-q--done" title={q.question}>
        <CircleCheck size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
        <span className="rv-q__line">Step {q.step_number} · {q.question}</span>
        <span className="rv-status rv-status--ok">Answered</span>
      </div>
    )
  }
  return (
    <div className="rv-q rv-q--open">
      <div className="rv-item__where"><HelpCircle size={12} /> Step {q.step_number} · {label}<span className="rv-pill">Needs answer</span></div>
      {q.found && <div className="rv-q__found">{q.found}</div>}
      {q.refs.length > 0 && (
        <div className="rv-item__src">
          {q.refs.map((n) => sourceMap.get(n)).filter((s): s is StepSource => !!s).map((s) => (
            <a key={s.n} href={sourceHref(s)} target="_blank" rel="noreferrer" onClick={(e) => { if (s.kind === 'doc') { e.preventDefault(); openReference(s) } }}>
              <Globe size={12} /> {s.title}
            </a>
          ))}
        </div>
      )}
      <div className="rv-q__ask">{q.question}</div>
      {(
        <form className="rv-q__form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onAnswer(text.trim()) }}>
          <input className="ui-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer…" />
          <Button size="sm" type="submit" variant="primary" icon={Check} disabled={!text.trim()}>Answer</Button>
          <Button size="sm" type="button" variant="ghost"
            onClick={onSkip}>Don't know</Button>
        </form>
      )}
    </div>
  )
}
