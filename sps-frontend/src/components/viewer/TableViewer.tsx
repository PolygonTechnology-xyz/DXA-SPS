import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, Plus, TriangleAlert } from 'lucide-react'
import { Button, IconButton, StepBadge, ActorChips, CitedText, type CiteSource } from '@/components/ui'

type CellKind = 'text' | 'label' | 'badge' | 'chips'

/** Review state of a cell: a proposal awaiting consent, no value, or where a value came from */
export interface CellMeta {
  state?: 'pending' | 'missing' | 'unknown'
  /** pending: the proposal text shown in the cell */
  text?: string
  origin?: 'web' | 'ai' | 'unsourced'
  source?: 'doc' | 'web' | 'user' | 'ai'
}

const SOURCE_BADGE: Record<string, { label: string; title: string; color: string; bg: string }> = {
  doc: { label: 'Doc', title: 'From your uploaded documents', color: '#1d4ed8', bg: '#eff6ff' },
  web: { label: 'Web ✓', title: 'From the web — you approved it', color: '#047857', bg: '#ecfdf5' },
  user: { label: 'You', title: 'Given by you', color: '#6d28d9', bg: '#f5f3ff' },
  ai: { label: 'AI ✓', title: 'Suggested by the AI without a source — you approved it', color: '#92400e', bg: '#fffbeb' },
}

const stripIds = (t: string) => t.replace(/\[[A-Za-z]\d+[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim()

function MetaContent({ meta }: { meta: CellMeta }) {
  if (meta.state === 'pending') {
    return (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>{stripIds(meta.text ?? '')}</span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: '#b45309' }}>
          {meta.origin === 'web' ? '🌐 Web' : '❓ No source'} · awaiting your answer in chat
        </span>
      </span>
    )
  }
  if (meta.state === 'unknown') return <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>Unknown</span>
  return <span style={{ color: 'var(--danger)', fontStyle: 'italic', fontSize: 12.5 }}>Not found</span>
}

function SourceBadge({ source }: { source: string }) {
  const b = SOURCE_BADGE[source]
  if (!b) return null
  return (
    <span title={b.title} style={{ display: 'inline-block', marginLeft: 6, padding: '0 5px', borderRadius: 4, fontSize: 10.5, fontWeight: 600, lineHeight: '16px', color: b.color, background: b.bg, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
      {b.label}
    </span>
  )
}

interface EditableCellProps {
  value: string
  onChange: (v: string) => void
  kind: CellKind
  sources?: Map<number, CiteSource>
  meta?: CellMeta
  readOnly?: boolean
}

function EditableCell({ value, onChange, kind, sources, meta, readOnly }: EditableCellProps) {
  const boldLabel = kind === 'label'
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  useEffect(() => { setVal(value) }, [value])
  const boxRef = useRef<HTMLTextAreaElement>(null)

  // the edit box grows with its text, so a long cell is edited in full, like it is shown
  const fit = () => {
    const el = boxRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useEffect(() => {
    if (!editing) return
    fit()
    const el = boxRef.current
    el?.setSelectionRange(el.value.length, el.value.length)   // cursor at the end
  }, [editing])

  const save = () => {
    setEditing(false)
    if (val !== value) onChange(val)
  }
  const cancel = () => {
    setEditing(false)
    setVal(value)
  }

  return (
    <td
      // the step number (badge) is not typed in — steps are numbered by their order
      onClick={() => { if (!meta?.state && !readOnly && kind !== 'badge') setEditing(true) }}
      style={{
        padding: editing ? 3 : '4px 8px',
        borderBottom: '1px solid var(--line)',
        borderRight: '1px solid var(--line)',
        verticalAlign: 'top',
        lineHeight: 1.35,
        overflowWrap: 'anywhere',
        color: kind === 'label' ? 'var(--ink-2)' : 'var(--ink)',
        background: editing ? 'var(--accent-soft)' : meta?.state === 'pending' ? '#fffbeb' : 'var(--surface)',
        boxShadow: meta?.state === 'pending' ? 'inset 3px 0 0 #f59e0b' : undefined,
        outline: 'none',
        whiteSpace: 'pre-wrap',
        cursor: meta?.state || readOnly || kind === 'badge' ? 'default' : 'text',
      }}
    >
      {editing ? (
        <textarea
          ref={boxRef}
          className="ui-cell-edit"
          value={val}
          autoFocus
          rows={1}
          onChange={(e) => { setVal(e.target.value); fit() }}
          onBlur={save}
          onKeyDown={(e) => {
            // Enter saves, Shift+Enter adds a line, Esc cancels
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() }
            if (e.key === 'Escape') { e.preventDefault(); cancel() }
          }}
        />
      ) : meta?.state ? (
        <MetaContent meta={meta} />
      ) : kind === 'badge' ? (
        <StepBadge n={val} />
      ) : kind === 'chips' ? (
        <ActorChips value={val} />
      ) : (
        <>
          <CitedText text={val} sources={sources} boldLabel={boldLabel} />
          {meta?.source && <SourceBadge source={meta.source} />}
        </>
      )}
    </td>
  )
}

// Minimum width of each column (px). They also set the proportions: at the table's
// minimum width every column is exactly its minimum; wider, all grow evenly. Narrower
// than that, the table scrolls sideways (with a scrollbar pinned to the screen bottom).
const COLUMN_MIN: Record<string, number> = {
  Step: 48, Actor: 140, Action: 260, Input: 130, Time: 60, Channel: 100,
  'Pain Point': 170, Digital: 140, 'Law (Government Order / Regulation / Judgement)': 190, Rationale: 200, 'Legal basis': 160,
  'How it is digitalized': 220, 'If rejected / returned': 220, 'World best practice': 240,
}
const DEFAULT_MIN = 140
const DELETE_COL = 30

/**
 * A horizontal scrollbar that stays at the bottom of the screen while any part of the
 * table is visible (position: sticky), instead of only at the table's end. It is a thin
 * proxy kept in sync with the table's own (hidden) scroll position, both ways.
 */
function StickyScrollbar({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  const barRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ scroll: 0, client: 0 })

  useEffect(() => {
    const el = target.current
    if (!el) return
    const measure = () => setSize({ scroll: el.scrollWidth, client: el.clientWidth })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    measure()
    // the table scrolled (trackpad, Shift+wheel, keyboard) → move the bar. Positions are
    // compared, so the echo from the other side (same value) does nothing.
    const onScroll = () => {
      const bar = barRef.current
      if (bar && Math.abs(bar.scrollLeft - el.scrollLeft) > 1) bar.scrollLeft = el.scrollLeft
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', onScroll) }
  }, [target])

  if (size.scroll <= size.client + 1) return null
  return (
    <div
      ref={barRef}
      className="ui-sticky-hscroll"
      onScroll={(e) => {
        // the bar moved → scroll the table
        const el = target.current
        if (el && Math.abs(el.scrollLeft - e.currentTarget.scrollLeft) > 1) el.scrollLeft = e.currentTarget.scrollLeft
      }}
    >
      <div style={{ width: size.scroll, height: 1 }} />
    </div>
  )
}

interface Props {
  columns: string[]
  rows: string[][]
  fullScreen?: boolean
  /** Columns whose "Label: text" prefix is bold (Action) */
  boldColumns?: number[]
  /** Columns shown as a small number badge (Step) */
  badgeColumns?: number[]
  /** Columns split into actor chips (Actor) */
  chipColumns?: number[]
  /** Sources for the [n] citation markers in cell text */
  sources?: Map<number, CiteSource>
  /** Review state per cell (row index, column index) */
  cellMeta?: (ri: number, ci: number) => CellMeta | undefined
  /** Deleting a row deletes the step (saved by the parent); without it the delete is only on screen */
  onDeleteRow?: (ri: number) => void
  /** View only: no delete column, no "Add step", no editing */
  readOnly?: boolean
  /** A cell the user edited (saved by the parent); without it the edit is only on screen */
  onCellChange?: (ri: number, ci: number, value: string) => void
  /** "Add step" (saved by the parent); without it the new row is only on screen */
  onAddRow?: () => void
}

export default function TableViewer({ columns, rows: initialRows, fullScreen, boldColumns, badgeColumns = [0], chipColumns = [1], sources, cellMeta, onDeleteRow, readOnly, onCellChange, onAddRow }: Props) {
  const kindOf = (ci: number): CellKind =>
    boldColumns?.includes(ci) ? 'label' : badgeColumns.includes(ci) ? 'badge' : chipColumns.includes(ci) ? 'chips' : 'text'
  const [rows, setRows] = useState<string[][]>(initialRows)
  // Follow new data (regenerate, chat edits) — the table is a view of the steps
  const dataKey = JSON.stringify(initialRows)
  useEffect(() => { setRows(initialRows) }, [dataKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const minOf = (c: string) => COLUMN_MIN[c] ?? DEFAULT_MIN
  const totalMin = columns.reduce((sum, c) => sum + minOf(c), 0)
  const widthOf = (c: string) => `${(minOf(c) / totalMin) * 100}%`
  const minTableWidth = totalMin + (readOnly ? 0 : DELETE_COL)
  const scrollRef = useRef<HTMLDivElement>(null)

  function updateCell(ri: number, ci: number, val: string) {
    onCellChange?.(ri, ci, val)
    setRows((prev) =>
      prev.map((row, i) => (i === ri ? row.map((cell, j) => (j === ci ? val : cell)) : row)),
    )
  }

  // a delete always asks first (the row index waiting for Yes)
  const [confirmRow, setConfirmRow] = useState<number | null>(null)

  function deleteRow(ri: number) {
    if (onDeleteRow) onDeleteRow(ri)
    else setRows((prev) => prev.filter((_, i) => i !== ri))
  }

  function addRow() {
    if (onAddRow) { onAddRow(); return }
    setRows((prev) => [...prev, columns.map(() => '')])
  }

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        // clip (not hidden): rounds the corners without becoming a scroll container,
        // which would stop the sticky scrollbar below from sticking to the screen
        overflow: 'clip',
        background: 'var(--surface)',
      }}
    >
      {/* one vertical scroll for the page: the table grows with its rows. Sideways it
          scrolls inside, driven by the sticky scrollbar (its own scrollbar is hidden) */}
      <div className="ui-table-scroll" ref={scrollRef}>
        <table
          className="ui-table"
          style={{
            borderCollapse: 'separate',
            borderSpacing: 0,
            fontSize: 12,
            tableLayout: 'fixed',
            width: '100%',
            minWidth: minTableWidth,
          }}
        >
          <colgroup>
            {!readOnly && <col style={{ width: DELETE_COL }} />}
            {columns.map((c) => <col key={c} style={{ width: widthOf(c) }} />)}
          </colgroup>
          <thead>
            <tr>
              {!readOnly && <th
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 3,
                  background: 'var(--surface)',
                  padding: 2,
                  borderBottom: '1px solid var(--line)',
                  borderRight: '1px solid var(--line)',
                }}
              />}
              {columns.map((c) => (
                <th
                  key={c}
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    background: 'var(--surface)',
                    textAlign: 'left',
                    padding: '5px 8px',
                    borderBottom: '1px solid var(--line)',
                    borderRight: '1px solid var(--line)',
                    fontSize: 10.5,
                    lineHeight: 1.3,
                    verticalAlign: 'bottom',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '.05em',
                    color: 'var(--muted)',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {!readOnly && <td
                  style={{
                    padding: 2,
                    borderBottom: '1px solid var(--line)',
                    borderRight: '1px solid var(--line)',
                    position: 'sticky',
                    left: 0,
                    zIndex: 1,
                    background: 'var(--surface)',
                    textAlign: 'center',
                    verticalAlign: 'top',
                    paddingTop: 1,
                  }}
                >
                  <IconButton icon={Trash2} label="Delete step" size="sm" danger onClick={() => setConfirmRow(ri)} style={{ color: 'var(--muted)' }} />
                </td>}
                {row.map((cell, ci) => (
                  <EditableCell
                    key={ci}
                    value={cell}
                    onChange={(val) => updateCell(ri, ci, val)}
                    readOnly={readOnly}
                    kind={kindOf(ci)}
                    sources={sources}
                    meta={cellMeta?.(ri, ci)}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <StickyScrollbar target={scrollRef} />
      {confirmRow !== null && rows[confirmRow] && (
        <ConfirmDelete
          stepNumber={rows[confirmRow][0]}
          action={rows[confirmRow][2] ?? ''}
          onCancel={() => setConfirmRow(null)}
          onConfirm={() => { const ri = confirmRow; setConfirmRow(null); deleteRow(ri) }}
        />
      )}
      {!readOnly && (
        <div style={{ padding: '4px 8px', borderTop: '1px solid var(--line)' }}>
          <Button size="sm" icon={Plus} onClick={addRow}>Add step</Button>
        </div>
      )}
    </div>
  )
}

/** "Delete step 4?" — shown over the page (also over the full-screen table) */
function ConfirmDelete({ stepNumber, action, onCancel, onConfirm }: {
  stepNumber: string
  action: string
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const n = stepNumber.replace(/[^\d.]/g, '') || stepNumber
  // "Label: long description [1]" → the label, without citation markers
  const text = action.replace(/\[\d+\]/g, '').trim()
  const label = text.includes(':') && text.indexOf(':') <= 40 ? text.slice(0, text.indexOf(':')) : text

  return createPortal(
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(17,24,39,.4)', display: 'grid', placeItems: 'center', padding: 16 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="ui-card"
        style={{ padding: 22, maxWidth: 420, width: '100%', boxShadow: '0 12px 40px rgba(16,24,40,.18)' }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--danger-soft)', color: 'var(--danger)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <TriangleAlert size={18} strokeWidth={1.8} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: '2px 0 6px', fontSize: 16, fontWeight: 600 }}>Delete step {n}?</h3>
            {label && (
              <p style={{ margin: '0 0 6px', fontSize: 14, color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>“{label.length > 120 ? `${label.slice(0, 120)}…` : label}”</p>
            )}
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.55 }}>
              The steps after it are renumbered. You can undo it right after.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="danger" icon={Trash2} autoFocus onClick={onConfirm}>Delete step</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
