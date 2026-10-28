import { REVIEW_FIELDS, type AsIsStep, type Finding, type ReviewField } from '@/api/projects'
import type { CellMeta } from '@/components/viewer/TableViewer'

// Client mirror of the server's review state (sps-api/src/services/asis-state.ts):
// a value is confirmed (in the step), pending (a finding awaiting consent), unknown
// (the user said so) or missing.

export const FIELD_LABEL: Record<ReviewField, string> = {
  pain_points: 'Pain point',
  digital_status: 'Digital status',
  legal_basis: 'Law (Government Order / Regulation / Judgement)',
}

export const DIGITAL_LABEL: Record<string, string> = {
  manual: 'Manual',
  partly: 'Partly digital',
  online: 'Fully online',
}

const hasValue = (v: unknown) => !!String(v ?? '').trim() && v !== '—'

export function pendingFindings(findings: Finding[] | undefined): Finding[] {
  return (findings ?? []).filter((f) => f.status === 'pending')
}

export interface Coverage {
  steps: number
  fields: Record<ReviewField, { confirmed: number; pending: number; unknown: number; missing: number }>
  pending: number
  pendingSteps: number
  missing: number
}

export function coverage(steps: AsIsStep[], findings: Finding[] | undefined): Coverage {
  const pending = pendingFindings(findings)
  const pendingField = new Set(pending.filter((f) => f.kind === 'field').map((f) => `${f.step_uid}:${f.field}`))
  const fields = Object.fromEntries(REVIEW_FIELDS.map((f) => [f, { confirmed: 0, pending: 0, unknown: 0, missing: 0 }])) as Coverage['fields']
  for (const s of steps) {
    for (const f of REVIEW_FIELDS) {
      const c = fields[f]
      if (hasValue(s[f])) c.confirmed++
      else if (pendingField.has(`${s.uid}:${f}`)) c.pending++
      else if (s.unknown_fields?.includes(f)) c.unknown++
      else c.missing++
    }
  }
  return {
    steps: steps.length,
    fields,
    pending: pending.length,
    pendingSteps: pending.filter((f) => f.kind === 'step').length,
    missing: REVIEW_FIELDS.reduce((n, f) => n + fields[f].missing, 0),
  }
}

/** Cell state for the review columns of the AS-IS table */
export function reviewCellMeta(step: AsIsStep, field: ReviewField, findings: Finding[] | undefined, reviewed: boolean): CellMeta | undefined {
  if (hasValue(step[field])) return { source: step.field_sources?.[field] }
  const pending = pendingFindings(findings).find((f) => f.kind === 'field' && f.step_uid === step.uid && f.field === field)
  if (pending) {
    const text = field === 'digital_status'
      ? `${DIGITAL_LABEL[pending.value ?? ''] ?? pending.value ?? ''}${pending.digital_note ? ` — ${pending.digital_note}` : ''}`
      : pending.value ?? ''
    return { state: 'pending', text, origin: pending.origin }
  }
  if (step.unknown_fields?.includes(field)) return { state: 'unknown' }
  return reviewed ? { state: 'missing' } : undefined
}

/** Short label of a finding, for cards and lists */
export function describeFinding(f: Finding, steps: AsIsStep[]): string {
  if (f.kind === 'step') {
    const after = steps.find((s) => s.uid === f.after_uid)
    return `New step${after ? ` after step ${after.step_number}` : ' at the start'}`
  }
  const step = steps.find((s) => s.uid === f.step_uid)
  return `Step ${step?.step_number ?? '?'} · ${FIELD_LABEL[f.field!]}`
}

export function findingText(f: Finding): string {
  const strip = (t: string) => t.replace(/\[[A-Za-z]\d+[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim()
  if (f.kind === 'step') return strip(`${f.step?.step_name ?? ''} — ${f.step?.action ?? ''}`)
  if (f.field === 'digital_status') return strip(`${DIGITAL_LABEL[f.value ?? ''] ?? f.value ?? ''}${f.digital_note ? ` — ${f.digital_note}` : ''}`)
  return strip(f.value ?? '')
}
