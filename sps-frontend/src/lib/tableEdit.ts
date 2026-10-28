import type { AsIsStep, ToBeStep } from '@/api/projects'
import { DIGITAL_LABEL } from '@/lib/asisReview'

// A table cell edited by the user → the step field it shows. The tables show some fields
// combined ("2d · 🚶 · ৳100", "Manual — D-Nothi"), so those are read back apart here.

const clean = (v: string) => (v.trim() === '—' ? '' : v.trim())

/** "2d · 🚶 · ৳100" (or "3", "3 days", "৳50") → days, visit, fee */
function parseTime(v: string): Pick<AsIsStep, 'time_days' | 'visit' | 'fee'> {
  const text = clean(v)
  const feeMatch = /৳\s*(\d+(?:\.\d+)?)/.exec(text)
  const days = /(\d+(?:\.\d+)?)/.exec(text.replace(/৳\s*\d+(?:\.\d+)?/g, ''))
  return {
    time_days: days ? Number(days[1]) : undefined,
    visit: /🚶|visit/i.test(text),
    fee: feeMatch ? Number(feeMatch[1]) : undefined,
  }
}

/** "Partly digital — MyGov portal [2]" → status + note; text without a known status is the note */
function parseDigital(v: string, step: AsIsStep): Pick<AsIsStep, 'digital_status' | 'digital_note'> {
  const text = clean(v)
  if (!text) return { digital_status: undefined, digital_note: undefined }
  const [head, ...rest] = text.split(' — ')
  const h = head.trim().toLowerCase()
  const status = Object.entries(DIGITAL_LABEL).find(([key, label]) => h === key || h === label.toLowerCase())?.[0]
    ?? (/^manual/.test(h) ? 'manual' : /^partly|^partial/.test(h) ? 'partly' : /^(fully )?online|^digital/.test(h) ? 'online' : undefined)
  if (!status) return { digital_status: step.digital_status, digital_note: text }
  return { digital_status: status, digital_note: rest.join(' — ').trim() || undefined }
}

/** The user typed it: it is their value now (not "missing" / "unknown" any more) */
function byUser(step: AsIsStep, field: 'pain_points' | 'digital_status' | 'legal_basis'): Partial<AsIsStep> {
  return {
    field_sources: { ...step.field_sources, [field]: 'user' },
    unknown_fields: step.unknown_fields?.filter((f) => f !== field),
  }
}

/** AS-IS columns: Step, Actor, Action, Input, Time, Pain Point, Digital, Law (Government Order / Regulation / Judgement) */
export function editAsisCell(step: AsIsStep, ci: number, value: string): AsIsStep {
  switch (ci) {
    case 1: return { ...step, actor: clean(value) }
    case 2: return { ...step, action: clean(value) }
    case 3: return { ...step, input: clean(value) }
    case 4: return { ...step, ...parseTime(value) }
    case 5: return { ...step, pain_points: clean(value), ...byUser(step, 'pain_points') }
    case 6: return { ...step, ...parseDigital(value, step), ...byUser(step, 'digital_status') }
    case 7: return { ...step, legal_basis: clean(value), ...byUser(step, 'legal_basis') }
    default: return step
  }
}

/** "In person" / "hybrid" / "online" → the TO-BE channel; anything else keeps the old one */
function parseChannel(v: string, old: ToBeStep['channel']): ToBeStep['channel'] {
  const t = clean(v).toLowerCase()
  if (/in.?person|office|physical/.test(t)) return 'in_person'
  if (/hybrid|both|mixed/.test(t)) return 'hybrid'
  if (/digital|online/.test(t)) return 'digital'
  return old
}

/** TO-BE columns: Step, Actor, Action, Channel, How it is digitalized, If rejected, Time, Rationale, Legal basis, World best practice */
export function editTobeCell(step: ToBeStep, ci: number, value: string): ToBeStep {
  switch (ci) {
    case 1: return { ...step, actor: clean(value) }
    case 2: return { ...step, action: clean(value) }
    case 3: return { ...step, channel: parseChannel(value, step.channel) }
    case 4: return { ...step, digital_how: clean(value) }
    case 5: return { ...step, if_rejected: clean(value) }
    case 6: return { ...step, ...parseTime(value) }
    case 7: return { ...step, simplification_rationale: clean(value) }
    case 8: return { ...step, legal_basis: clean(value) }
    case 9: return { ...step, best_practice: clean(value) }
    default: return step
  }
}

export function newAsisStep(n: number): AsIsStep {
  return { uid: `u${Date.now().toString(36)}`, step_number: n, step_name: '', actor: '', action: '', step_source: 'user' }
}

export function newTobeStep(n: number): ToBeStep {
  return { step_number: n, step_name: '', actor: '', action: '', channel: 'digital', simplification_rationale: '' }
}
