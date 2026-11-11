import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Upload, Users } from 'lucide-react'
import { projectsApi, type Project, type SpsData } from '@/api/projects'
import { Button } from '@/components/ui'
import { useSpsMeta, feedbackClass, taka } from '@/lib/sps'
import { downloadCsv } from '@/utils/download'

// Overview → SPS: cost settings (for TCVQ), ম্যাট্রিক্স-১ office, ম্যাট্রিক্স-২ priority,
// ম্যাট্রিক্স-৩ citizen feedback (template + import) and the implementation team.

const label = { fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '.05em' }
const input = { fontSize: 13, padding: '5px 8px', width: '100%' } as const

/** A text/number field that saves when it loses focus */
function Field({ title, value, type = 'text', onSave, hint }: { title: string; value: string | number | undefined; type?: 'text' | 'number'; onSave: (v: string) => void; hint?: string }) {
  const [v, setV] = useState(String(value ?? ''))
  useEffect(() => { setV(String(value ?? '')) }, [value])
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 12.5 }}>{title}</span>
      <input className="ui-input" type={type} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== String(value ?? '')) onSave(v) }} style={input} />
      {hint && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{hint}</span>}
    </label>
  )
}

/** Minimal CSV parser (quotes, commas, new lines) for the feedback import */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = '' }
    else cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim()))
}

// Bangla digits in survey sheets are common
const toNum = (s: string) => Number(s.trim().replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))))

export default function SpsOverview({ project }: { project: Project }) {
  const qc = useQueryClient()
  const { data: meta } = useSpsMeta()
  const sps: SpsData = project.sps ?? {}
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState('')

  const save = (patch: Partial<SpsData>) => projectsApi.update(project.id, { sps: patch } as never).then((p) => qc.setQueryData(['project', project.id], p))
  const setting = (k: keyof NonNullable<SpsData['settings']>) => (v: string) => save({ settings: { [k]: v === '' ? undefined : Number(v) } })
  const office = (k: keyof NonNullable<SpsData['office']>) => (v: string) => save({ office: { ...sps.office, [k]: v } })
  const s = { cost_fare: 200, cost_food: 200, cost_wage: 500, ...sps.settings }
  const priorityTotal = Object.values(sps.priority ?? {}).reduce((a, b) => a + Number(b), 0)
  const fb = sps.feedback

  function downloadTemplate() {
    if (!meta) return
    const cols = [...meta.feedback.map((q, i) => `${i + 1}. ${q.bn} (${q.en}) [1-5]`), 'মতামত / Comment']
    downloadCsv(cols, [cols.map(() => '')], `${project.name.replace(/\s+/g, '-')}-matrix3-feedback.csv`)
  }

  async function importFile(file: File) {
    if (!meta) return
    setImportMsg('')
    const rows = parseCsv(await file.text())
    const data = rows.filter((r) => toNum(r[0] ?? '') >= 1)            // skip the header
    const scores = data.map((r) => meta.feedback.map((_, i) => toNum(r[i] ?? '')))
    const comments = data.map((r) => r[meta.feedback.length] ?? '')
    try {
      const p = await projectsApi.importFeedback(project.id, scores, comments)
      qc.setQueryData(['project', project.id], p)
      setImportMsg(`Imported ${p.sps?.feedback?.respondents ?? 0} responses.`)
    } catch {
      setImportMsg('No valid rows: each row needs 14 scores from 1 to 5 (use the template).')
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="ui-card" style={{ padding: '18px 20px', marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
        <strong style={{ fontSize: 15 }}>Service simplification (SPS)</strong>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Settings and matrices of the guideline — used for TCVQ and the TO-BE</span>
      </div>

      {/* TCVQ settings */}
      <div style={label}>Citizen cost per office visit · TCVQ</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, margin: '6px 0 16px' }}>
        <Field title="Fare (৳)" type="number" value={s.cost_fare} onSave={setting('cost_fare')} />
        <Field title="Food (৳)" type="number" value={s.cost_food} onSave={setting('cost_food')} />
        <Field title="Lost daily wage (৳)" type="number" value={s.cost_wage} onSave={setting('cost_wage')} />
        <Field title="Users per year" type="number" value={sps.settings?.users_per_year} onSave={setting('users_per_year')} hint="For the annual saving" />
        <Field title="Unexpected cost now (৳)" type="number" value={sps.settings?.unexpected_asis} onSave={setting('unexpected_asis')} hint="Middlemen etc., per application" />
        <Field title="Office cost now (৳)" type="number" value={sps.settings?.office_cost_asis} onSave={setting('office_cost_asis')} />
        <Field title="Office cost proposed (৳)" type="number" value={sps.settings?.office_cost_tobe} onSave={setting('office_cost_tobe')} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -10, marginBottom: 16 }}>
        One visit costs the citizen {taka(Number(s.cost_fare) + Number(s.cost_food) + Number(s.cost_wage))}.
      </div>

      {/* ম্যাট্রিক্স-১ */}
      <div style={label}>Matrix-1 · Office profile · দপ্তর প্রোফাইল</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, margin: '6px 0 16px' }}>
        <Field title="Ministry / Division · মন্ত্রণালয়/বিভাগ" value={sps.office?.ministry} onSave={office('ministry')} />
        <Field title="Department / Agency · অধিদপ্তর/সংস্থা" value={sps.office?.department} onSave={office('department')} />
        <Field title="Office · দপ্তর" value={sps.office?.office} onSave={office('office')} />
      </div>

      {/* ম্যাট্রিক্স-২ */}
      <div style={{ ...label, display: 'flex', gap: 8 }}>
        <span style={{ flex: 1 }}>Matrix-2 · Service priority · সেবার অগ্রাধিকার</span>
        <span style={{ color: 'var(--ink)' }}>Total {priorityTotal || '—'} / 29</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '6px 16px', margin: '6px 0 16px' }}>
        {meta?.priority.map((c) => (
          <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span style={{ flex: 1 }} title={c.bn}>{c.en}</span>
            <select className="ui-input" value={sps.priority?.[c.key] ?? ''} style={{ width: 150, fontSize: 12, padding: '3px 6px' }}
              onChange={(e) => save({ priority: { ...sps.priority, [c.key]: Number(e.target.value) } })}>
              <option value="">—</option>
              {c.scale.map(([n, l]) => <option key={n} value={n}>{n} · {l}</option>)}
            </select>
          </label>
        ))}
      </div>

      {/* ম্যাট্রিক্স-৩ */}
      <div style={label}>Matrix-3 · Citizen feedback · সেবাগ্রহীতার মতামত</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0 6px' }}>
        <Button size="sm" icon={Download} onClick={downloadTemplate} disabled={!meta}>Questionnaire template (CSV)</Button>
        <Button size="sm" icon={Upload} onClick={() => fileRef.current?.click()} disabled={!meta}>Import responses</Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        {importMsg && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{importMsg}</span>}
      </div>
      {fb ? (
        <div style={{ fontSize: 12.5, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 6 }}>
            <Users size={14} style={{ alignSelf: 'center' }} />
            <span>{fb.respondents} respondents · total <strong>{fb.total}</strong> / 70</span>
            <strong style={{ color: feedbackClass(fb.total).color }}>{feedbackClass(fb.total).label}</strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '2px 16px', color: 'var(--ink-2)' }}>
            {meta?.feedback.map((q) => (
              <span key={q.key} title={q.bn} style={{ color: (fb.averages[q.key] ?? 5) < 2.5 ? 'var(--danger)' : undefined }}>{q.en}: {fb.averages[q.key] ?? '—'}</span>
            ))}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 16px' }}>
          Collect citizens' ratings (1–5) with the template, then import them. The scores and comments guide the TO-BE. 56–70 citizen-friendly · 36–55 SPS needed · 14–35 urgent.
        </p>
      )}

      {/* implementation team */}
      <div style={label}>Implementation team · বাস্তবায়ন টিম</div>
      <TeamField value={sps.team ?? ''} onSave={(team) => save({ team })} />
    </div>
  )
}

function TeamField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => { setV(value) }, [value])
  return (
    <textarea className="ui-input" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) onSave(v) }}
      placeholder={'1. Chair: … (Innovation Officer)\n2. Member: … (SPS master trainer)'}
      style={{ width: '100%', minHeight: 70, fontSize: 13, padding: 8, marginTop: 6, resize: 'vertical' }} />
  )
}
