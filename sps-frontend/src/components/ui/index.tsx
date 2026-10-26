import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Fragment } from 'react'
import { Sparkles, type LucideIcon } from 'lucide-react'
import { openReference } from '@/stores/reference'

// Shared UI kit — styles live in index.css (.ui-*). Icons come from lucide-react.

type Variant = 'default' | 'primary' | 'success' | 'danger' | 'ghost' | 'active'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: LucideIcon
  iconRight?: LucideIcon
  loading?: boolean
}

export function Button({ variant = 'default', size = 'md', icon: Icon, iconRight: IconRight, loading, className, children, ...rest }: ButtonProps) {
  const cls = ['ui-btn', variant !== 'default' && `ui-btn--${variant}`, size === 'sm' && 'ui-btn--sm', className].filter(Boolean).join(' ')
  const iconSize = size === 'sm' ? 15 : 16
  return (
    <button type="button" className={cls} {...rest}>
      {loading ? <Spinner size={iconSize} /> : Icon && <Icon size={iconSize} strokeWidth={1.9} />}
      {children}
      {IconRight && <IconRight size={iconSize} strokeWidth={1.9} />}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon
  label: string
  size?: 'sm' | 'md'
  danger?: boolean
}

export function IconButton({ icon: Icon, label, size = 'md', danger, className, ...rest }: IconButtonProps) {
  const cls = ['ui-icon-btn', size === 'sm' && 'ui-icon-btn--sm', danger && 'ui-icon-btn--danger', className].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} title={label} aria-label={label} {...rest}>
      <Icon size={size === 'sm' ? 15 : 18} strokeWidth={1.8} />
    </button>
  )
}

export interface SegOption<T extends string> { value: T; label: string; icon?: LucideIcon }

export function Segmented<T extends string>({ options, value, onChange }: { options: SegOption<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="ui-seg" role="group">
      {options.map(({ value: v, label, icon: Icon }) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {Icon && <Icon size={15} strokeWidth={1.9} />}
          {label}
        </button>
      ))}
    </div>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="ui-spin"
      style={{
        display: 'inline-block', width: size, height: size, flexShrink: 0,
        border: '2px solid currentColor', borderRightColor: 'transparent', borderRadius: '50%', opacity: 0.7,
      }}
    />
  )
}

export function StepBadge({ n }: { n: string | number }) {
  return <span className="ui-step">{n}</span>
}

// Stable colour per actor name, so the same actor has the same dot everywhere
const DOTS = ['#4f46e5', '#f59e0b', '#10b981', '#ec4899', '#0ea5e9', '#8b5cf6', '#ef4444', '#14b8a6']
export function actorColor(name: string) {
  let h = 0
  for (const c of name.trim().toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return DOTS[h % DOTS.length]
}

// Splits "Citizen (Parent) / Counter Staff" into actors — only at separators outside
// brackets, so "Head Office (AD → DD, Director)" stays one actor
function splitActors(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if ('([{'.includes(c)) depth++
    if (')]}'.includes(c)) depth = Math.max(0, depth - 1)
    const isAnd = depth === 0 && value.slice(i, i + 5).toLowerCase() === ' and '
    if (depth === 0 && ('/,;+&'.includes(c) || isAnd)) {
      parts.push(cur)
      cur = ''
      if (isAnd) i += 4
      continue
    }
    cur += c
  }
  parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}

// "Citizen (Parent) / Counter Staff" → two chips
export function ActorChips({ value }: { value: string }) {
  const parts = splitActors(value)
  if (parts.length === 0 || value.trim() === '—') return <span style={{ color: 'var(--muted)' }}>—</span>
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
      {parts.map((p, i) => (
        <span key={i} className="ui-chip"><i style={{ background: actorColor(p) }} />{p}</span>
      ))}
    </span>
  )
}

export function Pill({ children }: { children: ReactNode }) {
  return <span className="ui-pill">{children}</span>
}

// Assistant avatar — sparkle in a soft circle
export function AssistantAvatar({ size = 28 }: { size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'var(--accent-soft)', color: 'var(--accent)',
      display: 'grid', placeItems: 'center',
    }}>
      <Sparkles size={Math.round(size * 0.5)} strokeWidth={1.9} />
    </span>
  )
}

// Minimal inline markdown: **bold**, “quoted” text kept, line breaks preserved by the parent's pre-wrap
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') && p.length > 4
          ? <strong key={i} style={{ fontWeight: 600 }}>{p.slice(2, -2)}</strong>
          : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  )
}

// Page / section heading row: title + optional right-side actions
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.01em' }}>{title}</h1>
        {subtitle && <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 4 }}>{subtitle}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
    </div>
  )
}

export function Notice({ tone = 'danger', children, action }: { tone?: 'danger' | 'warn' | 'info'; children: ReactNode; action?: ReactNode }) {
  const c = tone === 'danger'
    ? { bg: 'var(--danger-soft)', line: 'var(--danger-line)', ink: 'var(--danger)' }
    : tone === 'warn'
    ? { bg: 'var(--warn-soft)', line: '#fde68a', ink: 'var(--warn)' }
    : { bg: 'var(--accent-soft)', line: '#c7d2fe', ink: 'var(--accent)' }
  return (
    <div style={{
      background: c.bg, border: `1px solid ${c.line}`, color: c.ink, borderRadius: 'var(--radius-sm)',
      padding: '10px 14px', marginBottom: 16, fontSize: 13.5,
      display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{children}</span>
      {action}
    </div>
  )
}

// Project status → label + colour (+ icon for compact lists)
const STATUS: Record<string, { label: string; fg: string; bg: string; line: string }> = {
  draft:         { label: 'Draft',          fg: '#4b5563', bg: '#f3f4f6', line: '#e5e7eb' },
  asis_complete: { label: 'AS-IS mapped',   fg: '#4338ca', bg: '#eef2ff', line: '#c7d2fe' },
  asis_approved: { label: 'AS-IS approved', fg: '#4338ca', bg: '#eef2ff', line: '#c7d2fe' },
  tobe_complete: { label: 'TO-BE drafted',  fg: '#b45309', bg: '#fffbeb', line: '#fde68a' },
  tobe_approved: { label: 'TO-BE approved', fg: '#15803d', bg: '#f0fdf4', line: '#bbf7d0' },
}
export function statusInfo(status: string) {
  return STATUS[status] ?? { label: status.replace(/_/g, ' '), fg: '#4b5563', bg: '#f3f4f6', line: '#e5e7eb' }
}
export function StatusBadge({ status }: { status: string }) {
  const s = statusInfo(status)
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 8px', borderRadius: 6,
      background: s.bg, color: s.fg, border: `1px solid ${s.line}`, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
    }}>
      <i style={{ width: 6, height: 6, borderRadius: '50%', background: s.fg, display: 'inline-block' }} />
      {s.label}
    </span>
  )
}

// ── Citations ───────────────────────────────────────────────────────────────
// Step text carries wiki-style markers "[1]" that point at step.sources entries.

export interface CiteSource { n: number; title: string; url: string; kind: 'web' | 'doc'; quotes?: string[] }

const API_BASE: string = import.meta.env.VITE_API_BASE ?? ''
/** Where a reference link goes. A web page opens with the quoted text highlighted (Chrome / Edge "text fragment") */
export const sourceHref = (s: Pick<CiteSource, 'url' | 'kind' | 'quotes'>) => {
  if (s.url.startsWith('/')) return API_BASE + s.url
  const quote = s.kind === 'web' ? s.quotes?.[0]?.split(/\s+/).filter(Boolean) : undefined
  if (!quote?.length) return s.url
  const enc = (w: string[]) => encodeURIComponent(w.join(' ')).replace(/-/g, '%2D')
  const text = quote.length > 10 ? `${enc(quote.slice(0, 5))},${enc(quote.slice(-5))}` : enc(quote)
  return `${s.url}${s.url.includes('#') ? '' : '#'}:~:text=${text}`
}

/** Clicking a reference: a website opens in a new tab; an uploaded document opens in the popup */
export const onSourceClick = (e: { preventDefault: () => void; stopPropagation: () => void }, src: CiteSource) => {
  e.stopPropagation()
  if (src.kind === 'doc') { e.preventDefault(); openReference(src) }
}

export function collectSources(steps: Array<{ sources?: CiteSource[] }>): Map<number, CiteSource> {
  const map = new Map<number, CiteSource>()
  for (const s of steps) for (const src of s.sources ?? []) if (!map.has(src.n)) map.set(src.n, src)
  return new Map([...map].sort((a, b) => a[0] - b[0]))
}

const hostOf = (s: CiteSource) => {
  if (s.kind === 'doc') return 'Uploaded document'
  try { return new URL(s.url).hostname.replace(/^www\./, '') } catch { return s.url }
}

/** Renders text with "[n]" turned into clickable superscript links; optional bold "Label:" prefix */
export function CitedText({ text, sources, boldLabel }: { text: string; sources?: Map<number, CiteSource>; boldLabel?: boolean }) {
  let label = ''
  let rest = text
  if (boldLabel) {
    const i = text.indexOf(':')
    if (i > 0 && i <= 40 && !/\[\d+\]/.test(text.slice(0, i))) { label = text.slice(0, i + 1); rest = text.slice(i + 1) }
  }
  const parts = rest.split(/(\[\d+\])/g)
  return (
    <>
      {label && <strong style={{ fontWeight: 600, color: 'var(--ink)' }}>{label}</strong>}
      {parts.map((p, i) => {
        const m = /^\[(\d+)\]$/.exec(p)
        if (!m) return <Fragment key={i}>{p}</Fragment>
        const src = sources?.get(Number(m[1]))
        if (!src) return null
        return (
          <a
            key={i}
            className="ui-cite"
            href={sourceHref(src)}
            target="_blank"
            rel="noreferrer"
            title={`${src.title} — ${hostOf(src)}`}
            onClick={(e) => onSourceClick(e, src)}
          >
            [{src.n}]
          </a>
        )
      })}
    </>
  )
}

/** Numbered reference list under a table/diagram */
export function ReferenceList({ sources, title = 'References' }: { sources: Map<number, CiteSource>; title?: string }) {
  if (sources.size === 0) return null
  return (
    <div className="ui-card" style={{ marginTop: 14, padding: '14px 16px' }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--ink-2)' }}>{title}</div>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[...sources.values()].map((s) => (
          <li key={s.n} id={`ref-${s.n}`} style={{ display: 'flex', gap: 8, fontSize: 13, lineHeight: 1.5, minWidth: 0 }}>
            <span style={{ color: 'var(--accent)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>[{s.n}]</span>
            <a href={sourceHref(s)} target="_blank" rel="noreferrer" onClick={(e) => onSourceClick(e, s)} style={{ color: 'var(--ink)', textDecoration: 'none', minWidth: 0, overflowWrap: 'anywhere' }}>
              <span style={{ textDecoration: 'underline', textDecorationColor: 'var(--line-strong)', textUnderlineOffset: 3 }}>{s.title}</span>
              <span style={{ color: 'var(--muted)' }}> — {hostOf(s)}</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  )
}
