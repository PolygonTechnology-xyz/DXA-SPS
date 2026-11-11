import type { AsIsStep, ToBeStep } from '@/api/projects'

// The TO-BE JSON arrives in small pieces while the AI writes it. Each step is one array in
// "tobe_steps": [[1,"Apply Online","Applicant",…], …] — every complete one is shown at once.

const TOBE_KEYS = ['step_number', 'step_name', 'actor', 'action', 'channel', 'time_days', 'merged_from', 'simplification_rationale', 'legal_basis', 'step_type', 'visit', 'fee', 'no_goto'] as const

// [S3], [D1:4], [W1, S2] — the links are added when the run ends
const CITE = /\s*\[\s*[A-Za-z]\d+(?::\d+(?:-\d+)?)?(?:\s*,\s*[A-Za-z]\d+(?::\d+(?:-\d+)?)?)*\s*\]/g

/** The complete rows of the array under `key` in partial JSON text */
export function completeRows(text: string, key: string): unknown[][] {
  const at = text.indexOf(`"${key}"`)
  if (at < 0) return []
  const open = text.indexOf('[', at)
  if (open < 0) return []
  const rows: unknown[][] = []
  let depth = 0, start = -1, inStr = false, esc = false
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '[') { if (depth === 0) start = i; depth++ }
    else if (ch === ']') {
      if (depth === 0) break   // end of the list
      depth--
      if (depth === 0 && start >= 0) {
        try { const r = JSON.parse(text.slice(start, i + 1)); if (Array.isArray(r)) rows.push(r) } catch { /* skip a bad row */ }
        start = -1
      }
    }
  }
  return rows
}

export function liveTobeSteps(text: string): ToBeStep[] {
  return completeRows(text, 'tobe_steps').map((r) => {
    const o: Record<string, unknown> = {}
    TOBE_KEYS.forEach((k, i) => { o[k] = typeof r[i] === 'string' ? (r[i] as string).replace(CITE, '').trim() : r[i] })
    return o as unknown as ToBeStep
  })
}

// ── AS-IS ────────────────────────────────────────────────────────────────────

const ASIS_KEYS = ['step_number', 'step_name', 'actor', 'action', 'input', 'time_days', 'pain_points', 'step_type', 'visit', 'fee', 'no_goto'] as const
const clean = (v: unknown) => (typeof v === 'string' ? v.replace(CITE, '').trim() : v)

/** The AS-IS steps written so far ("steps": [[1,"Submit Application",…], …]) */
export function liveAsisSteps(text: string): AsIsStep[] {
  return completeRows(text, 'steps').map((r) => {
    const o: Record<string, unknown> = {}
    ASIS_KEYS.forEach((k, i) => { o[k] = clean(r[i]) })
    return o as unknown as AsIsStep
  })
}

const DIGITAL = ['full', 'partly', 'partial', 'none', 'manual', 'digital']

/**
 * The review rows written so far ("review": [[n, pain, digital, system, evidence, law, days, visit, fee], …])
 * laid over the steps — only where a step has no value yet. Returns how many steps were reviewed.
 */
export function withLiveReview(steps: AsIsStep[], text: string): { steps: AsIsStep[]; reviewed: number } {
  const rows = completeRows(text, 'review')
  if (!rows.length) return { steps, reviewed: 0 }
  const byNumber = new Map(rows.map((r) => [Number(r[0]), r]))
  const plain = (v: unknown) => String(clean(v) ?? '').replace(/\[\d+\]/g, '').trim()
  return {
    reviewed: rows.length,
    steps: steps.map((s) => {
      const r = byNumber.get(Number(s.step_number))
      if (!r) return s
      const [, pain, digital, system, , law, days, visit, fee] = r
      const d = String(digital ?? '').trim().toLowerCase()
      const next = { ...s } as AsIsStep & Record<string, unknown>
      if (!plain(s.pain_points) && plain(pain)) next.pain_points = plain(pain)
      if (!s.digital_status && d) { next.digital_status = (DIGITAL.includes(d) ? d : digital) as AsIsStep['digital_status']; if (plain(system)) next.digital_note = plain(system) }
      if (!plain(s.legal_basis) && plain(law)) next.legal_basis = plain(law)
      if ((s.time_days == null || String(s.time_days) === '') && days != null && Number.isFinite(Number(days))) next.time_days = Number(days)
      if (s.visit == null && visit != null) next.visit = Number(visit) === 1 || visit === true
      if (!s.fee && Number(fee) > 0) next.fee = Number(fee)
      return next
    }),
  }
}
