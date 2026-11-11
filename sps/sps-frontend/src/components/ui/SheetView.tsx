import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Spinner } from '@/components/ui'

// An uploaded spreadsheet shown as it is: sheet tabs, column letters, row numbers, merged
// cells. Cells holding the text the AI took are marked in yellow.

interface Sheet { name: string; rows: string[][]; merges: Array<[number, number, number, number]> }

const colName = (i: number) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()

/** A cell is marked when its text is part of a quote, or a quote is part of it */
function cellMatches(cell: string, quotes: string[]): boolean {
  const c = norm(cell)
  if (c.length < 3) return false
  // the AI read rows as "cell | cell | cell", so a quote may span several cells
  const pieces = quotes.flatMap((q) => q.split(/\s*\|\s*/)).map(norm).filter((p) => p.length >= 3)
  return pieces.some((p) => p.includes(c) || (p.length >= 6 && c.includes(p)))
}

export default function SheetView({ projectId, fileId, quotes, citedSheet }: { projectId: string; fileId: string; quotes: string[]; citedSheet?: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['file-sheet', fileId],
    queryFn: () => api.get<{ name: string; sheets: Sheet[] }>(`/api/projects/${projectId}/files/${fileId}/sheet`),
    retry: false,
    staleTime: Infinity,
  })
  const sheets = data?.sheets ?? []
  const [tab, setTab] = useState(0)
  // open the cited sheet (else the first one with a marked cell)
  useEffect(() => {
    if (!sheets.length) return
    let i = citedSheet ? sheets.findIndex((s) => s.name === citedSheet) : -1
    if (i < 0) i = sheets.findIndex((s) => s.rows.some((r) => r.some((c) => cellMatches(c, quotes))))
    setTab(Math.max(0, i))
  }, [sheets, citedSheet, quotes])

  const sheet = sheets[tab]
  const { spans, covered } = useMemo(() => {
    const spans = new Map<string, { rowSpan: number; colSpan: number }>()
    const covered = new Set<string>()
    for (const [r1, c1, r2, c2] of sheet?.merges ?? []) {
      spans.set(`${r1}:${c1}`, { rowSpan: r2 - r1 + 1, colSpan: c2 - c1 + 1 })
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(`${r}:${c}`)
    }
    return { spans, covered }
  }, [sheet])
  const width = Math.max(0, ...(sheet?.rows ?? []).map((r) => r.length))

  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    boxRef.current?.querySelector('td[data-quote]')?.scrollIntoView({ block: 'center', inline: 'center' })
  }, [sheet])

  if (isLoading) return <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13, padding: '14px 18px' }}><Spinner size={14} /> Opening the spreadsheet…</div>
  if (error || !sheet) return <p style={{ color: 'var(--danger)', fontSize: 13, padding: '14px 18px' }}>The spreadsheet could not be opened here — use “Open full file”.</p>

  const head: React.CSSProperties = { background: '#f3f4f6', color: '#6b7280', fontWeight: 500, fontSize: 11.5, textAlign: 'center', border: '1px solid #d1d5db', padding: '2px 6px', position: 'sticky', zIndex: 1 }
  return (
    // fills the popup: the grid scrolls both ways, the sheet tabs stay fixed at the bottom
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div ref={boxRef} style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12.5, color: '#111827' }}>
          <thead>
            <tr>
              <th style={{ ...head, top: 0, left: 0, zIndex: 2, minWidth: 36 }} />
              {Array.from({ length: width }, (_, c) => <th key={c} style={{ ...head, top: 0 }}>{colName(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r}>
                <th style={{ ...head, left: 0, minWidth: 40 }}>{r + 1}</th>
                {Array.from({ length: width }, (_, c) => {
                  if (covered.has(`${r}:${c}`)) return null
                  const v = row[c] ?? ''
                  const hit = !!quotes.length && cellMatches(v, quotes)
                  return (
                    <td
                      key={c}
                      {...spans.get(`${r}:${c}`)}
                      data-quote={hit || undefined}
                      style={{
                        border: '1px solid #e5e7eb', padding: '3px 7px', verticalAlign: 'top',
                        minWidth: 130, maxWidth: 380, whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
                        // yellow mark on the cited cells — off for now: background: hit ? '#fde047' : undefined,
                        fontWeight: r === 0 ? 600 : undefined,
                      }}
                    >
                      {v}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheets.length > 0 && (
        <div style={{ display: 'flex', gap: 2, padding: '0 8px', background: '#f3f4f6', borderTop: '1px solid #d1d5db', overflowX: 'auto', flexShrink: 0 }}>
          {sheets.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setTab(i)}
              style={{
                border: 0, borderBottom: i === tab ? '2px solid #16a34a' : '2px solid transparent',
                background: i === tab ? '#fff' : 'transparent', color: i === tab ? '#15803d' : '#4b5563',
                fontWeight: i === tab ? 600 : 400, fontSize: 12.5, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
