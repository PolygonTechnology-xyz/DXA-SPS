import { TriangleAlert, Zap, CalendarClock, Hourglass, Globe, Award } from 'lucide-react'
import type { ToBeStep } from '@/api/projects'

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

/** Text with its [n] markers taken out and the pages they point to shown as links after it */
export function CitedText({ text, step }: { text: string; step: ToBeStep }) {
  const ns = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
  const refs = ns.map((n) => step.sources?.find((s) => s.n === n)).filter((s): s is NonNullable<typeof s> => !!s)
  return (
    <>
      {text.replace(/\s*\[\d+\]/g, '').trim()}
      {refs.length > 0 && (
        <span className="cite-links">
          {refs.map((s) => (
            <a key={s.n} href={s.url} target="_blank" rel="noreferrer" title={s.title} className="cite-link">
              <Globe size={11} /> {s.kind === 'web' ? host(s.url) : s.title}
            </a>
          ))}
        </span>
      )}
    </>
  )
}

type Effort = NonNullable<ToBeStep['implementation']>['effort']

const GROUPS: Array<{ effort: Effort; title: string; sub: string; icon: typeof Zap }> = [
  { effort: 'quick', title: 'Quick wins', sub: 'Under 3 months — existing systems, no law change', icon: Zap },
  { effort: 'medium', title: 'Medium term', sub: '3 to 12 months', icon: CalendarClock },
  { effort: 'long', title: 'Long term', sub: 'Over a year — a new system or integration', icon: Hourglass },
]
const CHANNEL: Record<string, string> = { digital: 'Digital', in_person: 'In person', hybrid: 'Hybrid' }
const clean = (t?: string) => String(t ?? '').replace(/\s*\[\d+\]/g, '').trim()
const label = (s: ToBeStep) => {
  const a = clean(s.action)
  const i = a.indexOf(':')
  return (i > 0 && i <= 40 ? a.slice(0, i) : '') || s.step_name || `Step ${s.step_number}`
}

/**
 * How each TO-BE step is put in place, as a roadmap: quick wins first. Every card says the
 * system, what must exist first, any law change, who owns it and the fallback — and the
 * reviewer's warnings that are still open.
 */
export default function ImplementationPlan({ steps }: { steps: ToBeStep[] }) {
  const planned = steps.filter((s) => s.implementation)
  const openChecks = steps.reduce((n, s) => n + (s.checks?.length ?? 0), 0)

  if (!planned.length) {
    return (
      <div className="ui-card" style={{ padding: '28px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
        This TO-BE has no implementation plan yet. Press <strong>Regenerate</strong> to design it again with the plan.
      </div>
    )
  }

  return (
    <div>
      <div className="ip-summary">
        {GROUPS.map((g) => {
          const n = planned.filter((s) => s.implementation!.effort === g.effort).length
          return n ? <span key={g.effort} className={`ip-chip ip-chip--${g.effort}`}><g.icon size={13} /> {n} {g.title.toLowerCase()}</span> : null
        })}
        {openChecks > 0 && <span className="ip-chip ip-chip--warn"><TriangleAlert size={13} /> {openChecks} open check{openChecks > 1 ? 's' : ''}</span>}
      </div>

      {GROUPS.map((g) => {
        const list = planned.filter((s) => s.implementation!.effort === g.effort)
        if (!list.length) return null
        return (
          <section key={g.effort} className="ip-group">
            <div className="ip-group__head">
              <span className={`ip-group__icon ip-group__icon--${g.effort}`}><g.icon size={15} /></span>
              <strong>{g.title}</strong>
              <span className="ip-group__sub">{g.sub}</span>
            </div>
            <div className="ip-grid">
              {list.map((s) => {
                const im = s.implementation!
                return (
                  <article key={s.step_number} className="ip-card">
                    <header className="ip-card__head">
                      <span className="ui-step">{s.step_number}</span>
                      <strong>{label(s)}</strong>
                      <span className={`cmp-ch cmp-ch--${s.channel}`}>{CHANNEL[s.channel] ?? s.channel}</span>
                    </header>
                    {im.owner && <div className="ip-owner">Owner: {im.owner}</div>}
                    {s.digital_how && <Row k="How it works" v={clean(s.digital_how)} />}
                    {s.best_practice && (
                      <div className="ip-row ip-row--bp">
                        <span className="ip-row__k"><Award size={12} /> Best practice</span>
                        <span className="ip-row__v"><CitedText text={s.best_practice} step={s} /></span>
                      </div>
                    )}
                    {im.prerequisites && <Row k="Needed first" v={im.prerequisites} />}
                    {im.legal_fit && <Row k="Allowed under" v={clean(im.legal_fit)} tone="law" />}
                    {s.if_rejected && <Row k="If rejected" v={clean(s.if_rejected)} />}
                    {im.fallback && <Row k="Fallback" v={im.fallback} />}
                    {s.checks?.map((c, i) => (
                      <div key={i} className={`ip-check ip-check--${c.severity}`}><TriangleAlert size={13} /> {c.issue}</div>
                    ))}
                  </article>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Row({ k, v, tone }: { k: string; v: string; tone?: 'law' }) {
  return (
    <div className={`ip-row${tone ? ` ip-row--${tone}` : ''}`}>
      <span className="ip-row__k">{k}</span>
      <span className="ip-row__v">{v}</span>
    </div>
  )
}
