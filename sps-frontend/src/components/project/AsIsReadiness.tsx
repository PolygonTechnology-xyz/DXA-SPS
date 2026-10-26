import { ClipboardCheck, MessageSquare, RotateCw } from 'lucide-react'
import { REVIEW_FIELDS, type AsIsStep, type Project } from '@/api/projects'
import { Button } from '@/components/ui'
import { coverage, pendingFindings, describeFinding, findingText, FIELD_LABEL } from '@/lib/asisReview'

interface Props {
  project: Project
  steps: AsIsStep[]
  onReview: () => void
  onOpenChat: () => void
}

/**
 * Readiness of the AS-IS before approval: how many steps have a confirmed pain point,
 * digital status and law / regulation, what waits for the user's consent, what is open.
 */
export default function AsIsReadiness({ project, steps, onReview, onOpenChat }: Props) {
  const review = project.asis_review
  const findings = project.asis_findings ?? []
  const pending = pendingFindings(findings)
  const cov = coverage(steps, findings)
  const openQuestions = (review?.questions ?? []).filter((q) => {
    const s = steps.find((x) => x.uid === q.step_uid)
    return s && !String(s[q.field] ?? '').trim() && !s.unknown_fields?.includes(q.field)
  })

  if (!review && !pending.length) {
    return (
      <div className="ui-card" style={{ padding: '14px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <ClipboardCheck size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Not reviewed yet</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Pain point, digital status and law / regulation have not been checked for these steps.</div>
        </div>
        <Button variant="primary" icon={ClipboardCheck} onClick={onReview}>Review now</Button>
      </div>
    )
  }

  const bar = (n: number, color: string) => (n > 0 ? <span style={{ flex: n, background: color }} /> : null)

  return (
    <div className="ui-card" style={{ padding: '14px 16px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <ClipboardCheck size={18} style={{ color: 'var(--accent)' }} />
        <strong style={{ fontSize: 14, flex: 1 }}>AS-IS review{review?.country ? ` · ${review.country}` : ''}</strong>
        {review && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            Reviewed {new Date(review.reviewed_at * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <Button size="sm" icon={RotateCw} onClick={onReview}>Review again</Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        {REVIEW_FIELDS.map((f) => {
          const c = cov.fields[f]
          return (
            <div key={f}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                <span style={{ fontWeight: 600 }}>{FIELD_LABEL[f]}</span>
                <span style={{ color: 'var(--muted)' }}>{c.confirmed}/{cov.steps}</span>
              </div>
              <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--line)' }}>
                {bar(c.confirmed, '#16a34a')}{bar(c.pending, '#f59e0b')}{bar(c.unknown, '#9ca3af')}{bar(c.missing, '#fca5a5')}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                {[c.pending && `${c.pending} to confirm`, c.unknown && `${c.unknown} unknown`, c.missing && `${c.missing} not found`].filter(Boolean).join(' · ') || 'Complete'}
              </div>
            </div>
          )
        })}
      </div>

      {(pending.length > 0 || openQuestions.length > 0) && (
        <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: pending.length ? '#fffbeb' : 'var(--accent-soft)', border: `1px solid ${pending.length ? '#fde68a' : '#c7d2fe'}`, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240, fontSize: 13, lineHeight: 1.55 }}>
            {pending.length > 0 && (
              <div style={{ color: '#92400e' }}>
                <strong>{pending.length} item{pending.length > 1 ? 's' : ''} from the web need your decision</strong> before the AS-IS can be approved.
                {cov.pendingSteps > 0 && (
                  <div style={{ marginTop: 4 }}>
                    Proposed new steps: {pending.filter((f) => f.kind === 'step').map((f) => `${describeFinding(f, steps).replace('New step ', '')}: “${findingText(f).split(' — ')[0]}”`).join('; ')}
                  </div>
                )}
              </div>
            )}
            {openQuestions.length > 0 && (
              <div style={{ color: 'var(--ink-2)', marginTop: pending.length ? 4 : 0 }}>
                {openQuestions.length} open question{openQuestions.length > 1 ? 's' : ''} — values nobody could find. Answer them in the chat, or approve with them missing.
              </div>
            )}
          </div>
          <Button size="sm" icon={MessageSquare} onClick={onOpenChat}>Open chat</Button>
        </div>
      )}
    </div>
  )
}
