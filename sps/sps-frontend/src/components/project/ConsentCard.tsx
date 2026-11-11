import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, X, Globe, Sparkles, SkipForward } from 'lucide-react'
import { projectsApi, type Project } from '@/api/projects'
import { AssistantAvatar, Button, Spinner, sourceHref } from '@/components/ui'
import { openReference } from '@/stores/reference'
import { describeFinding, findingText } from '@/lib/asisReview'

const TEXT = {
  en: {
    intro: (n: number) => `I found ${n} item${n > 1 ? 's' : ''} that ${n > 1 ? 'are' : 'is'} not in your uploaded files. Should I use ${n > 1 ? 'them' : 'it'} in the AS-IS? Please confirm.`,
    use: 'Use', skip: "Don't use", useAll: 'Use all', useNone: 'Use none',
    used: 'Used', skipped: 'Not used', gone: 'Step removed', noSource: 'No source — suggested by the AI',
    hint: 'You can also answer in the chat, e.g. “use 1 and 3”.',
    // values with no source: the user confirms them
    cIntro: (n: number) => `I couldn't find a source (your files or the web) for ${n > 1 ? `these ${n} values` : 'this value'}. ${n > 1 ? 'Are they' : 'Is it'} correct?`,
    yes: 'Yes', no: 'No', skipIt: 'Skip', yesAll: 'Yes to all', skipAll: 'Skip all',
    confirmed: 'Confirmed by you', notCorrect: 'Not correct — left empty', skippedIt: 'Skipped — left empty',
    noSourceFound: 'No source found — answer only if you know',
    cHint: 'Yes saves it (you are the source). No or Skip leaves it empty — you can also type the right value in the chat.',
  },
  bn: {
    intro: (n: number) => `আপনার আপলোড করা ফাইলে নেই এমন ${n}টি তথ্য আমি পেয়েছি। এগুলো কি AS-IS-এ ব্যবহার করব? কনফার্ম করুন।`,
    use: 'ব্যবহার করুন', skip: 'বাদ দিন', useAll: 'সব ব্যবহার করুন', useNone: 'কোনোটিই না',
    used: 'ব্যবহার হয়েছে', skipped: 'বাদ দেওয়া হয়েছে', gone: 'ধাপটি মুছে ফেলা হয়েছে', noSource: 'কোনো উৎস নেই — AI-এর অনুমান',
    hint: 'চ্যাটেও লিখতে পারেন, যেমন “১ আর ৩ ব্যবহার করো”।',
    cIntro: (n: number) => `এই ${n}টি তথ্যের কোনো উৎস (ফাইল বা ওয়েব) পাইনি। এগুলো কি ঠিক?`,
    yes: 'হ্যাঁ', no: 'না', skipIt: 'বাদ দিন', yesAll: 'সবগুলো হ্যাঁ', skipAll: 'সব বাদ দিন',
    confirmed: 'আপনি নিশ্চিত করেছেন', notCorrect: 'ঠিক নয় — খালি রাখা হয়েছে', skippedIt: 'বাদ — খালি রাখা হয়েছে',
    noSourceFound: 'কোনো উৎস পাওয়া যায়নি — জানা থাকলে উত্তর দিন',
    cHint: '“হ্যাঁ” দিলে সংরক্ষণ হবে (আপনিই উৎস)। “না” বা “বাদ দিন” দিলে খালি থাকবে — সঠিক তথ্য চ্যাটে লিখতেও পারেন।',
  },
}

/**
 * A chat-rail card asking the user's consent for information that is not in their
 * files (found on the web, or suggested without a source). Each item can be used or
 * not; nothing reaches the AS-IS until the user decides.
 */
export default function ConsentCard({ projectId, project, findingIds, lang = 'en', mode }: {
  projectId: string
  project: Project | undefined
  findingIds: string[]
  lang?: 'bn' | 'en'
  /** confirm: values with no source — Yes / No / Skip */
  mode?: 'confirm'
}) {
  const confirm = mode === 'confirm'
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const t = TEXT[lang] ?? TEXT.en
  const all = project?.asis_findings ?? []
  const steps = project?.asis_steps ?? []
  const items = findingIds.map((id) => all.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f)
  const pending = items.filter((f) => f.status === 'pending')

  async function decide(ids: string[], decision: 'accept' | 'reject' | 'skip') {
    if (!ids.length) return
    setBusy(ids.length > 1 ? 'all' : ids[0])
    setError('')
    try {
      const r = await projectsApi.decideFindings(projectId, ids.map((id) => ({ id, decision })))
      qc.setQueryData(['project', projectId], (old: Project | undefined) =>
        old ? { ...old, asis_steps: r.asis_steps, asis_findings: r.asis_findings } : old)
    } catch {
      setError('Could not save your decision. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  if (!items.length) return null

  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'flex-start' }}>
      <AssistantAvatar />
      <div style={{ flex: 1, minWidth: 0, border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 12, borderTopLeftRadius: 4, padding: '11px 12px', fontSize: 13.5, lineHeight: 1.55 }}>
        <div style={{ color: '#92400e', fontWeight: 600, marginBottom: 8 }}>{confirm ? t.cIntro(items.length) : t.intro(items.length)}</div>

        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((f, i) => (
            <li key={f.id} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 2 }}>
                {i + 1}. {describeFinding(f, steps)}
              </div>
              <div style={{ color: 'var(--ink)', overflowWrap: 'anywhere' }}>{findingText(f)}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
                {f.origin === 'web' && f.sources.length
                  ? f.sources.map((s) => (
                    <a key={s.id} href={sourceHref(s)} target="_blank" rel="noreferrer" onClick={(e) => { if (s.kind === 'doc') { e.preventDefault(); openReference(s) } }} style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4, overflowWrap: 'anywhere' }}>
                      <Globe size={12} /> {s.title}
                    </a>
                  ))
                  : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Sparkles size={12} /> {confirm ? t.noSourceFound : t.noSource}</span>}
              </div>
              <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                {f.status === 'pending' && confirm ? (
                  <>
                    <Button size="sm" variant="primary" icon={Check} disabled={!!busy} onClick={() => decide([f.id], 'accept')}>{t.yes}</Button>
                    <Button size="sm" icon={X} disabled={!!busy} onClick={() => decide([f.id], 'reject')}>{t.no}</Button>
                    <Button size="sm" variant="ghost" icon={SkipForward} disabled={!!busy} onClick={() => decide([f.id], 'skip')}>{t.skipIt}</Button>
                    {busy === f.id && <Spinner size={13} />}
                  </>
                ) : f.status === 'pending' ? (
                  <>
                    <Button size="sm" variant="primary" icon={Check} disabled={!!busy} onClick={() => decide([f.id], 'accept')}>{t.use}</Button>
                    <Button size="sm" variant="ghost" icon={X} disabled={!!busy} onClick={() => decide([f.id], 'reject')}>{t.skip}</Button>
                    {busy === f.id && <Spinner size={13} />}
                  </>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 600, color: f.status === 'accepted' ? '#15803d' : 'var(--muted)' }}>
                    {confirm
                      ? (f.status === 'accepted' ? `✓ ${t.confirmed}` : f.status === 'rejected' ? `✕ ${t.notCorrect}` : f.status === 'skipped' ? `» ${t.skippedIt}` : t.gone)
                      : (f.status === 'accepted' ? `✓ ${t.used}` : f.status === 'rejected' ? `✕ ${t.skipped}` : t.gone)}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>

        {pending.length > 1 && confirm && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
            <Button size="sm" variant="primary" disabled={!!busy} onClick={() => decide(pending.map((f) => f.id), 'accept')}>{t.yesAll}</Button>
            <Button size="sm" disabled={!!busy} onClick={() => decide(pending.map((f) => f.id), 'skip')}>{t.skipAll}</Button>
            {busy === 'all' && <Spinner size={13} />}
          </div>
        )}
        {pending.length > 1 && !confirm && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
            <Button size="sm" variant="primary" disabled={!!busy} onClick={() => decide(pending.map((f) => f.id), 'accept')}>{t.useAll}</Button>
            <Button size="sm" disabled={!!busy} onClick={() => decide(pending.map((f) => f.id), 'reject')}>{t.useNone}</Button>
            {busy === 'all' && <Spinner size={13} />}
          </div>
        )}
        {pending.length > 0 && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{confirm ? t.cHint : t.hint}</div>}
        {error && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
      </div>
    </div>
  )
}
