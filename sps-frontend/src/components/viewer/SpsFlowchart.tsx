import { useMemo } from 'react'

// Process map in the notation of the SPS guideline (ছক-৪): start / end circles, numbered
// steps, rectangle = activity, diamond = decision (a "No" loops back), document shape,
// ✉ = message, a P (performer) / T (time) box per step and a totals box.

interface Step {
  step_number: number
  actor?: string
  action?: string
  time_days?: number | string
  step_type?: string
  visit?: boolean
  no_goto?: number
}

const W = 760
const NUM_X = 8, NUM_W = 34
const SHAPE_X = 92, SHAPE_W = 380
const PT_X = 512, PT_W = 236
const ROW_GAP = 30
const LINE_H = 15
const CHARS = 54                      // per line inside the shape at 12px
const CITIZEN = /citizen|applicant|beneficiary|heir|নাগরিক|আবেদনকারী|সেবাগ্রহীতা/i

const plain = (t: unknown) => String(t ?? '').replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim()

function wrap(text: string, max: number, lines = 3): string[] {
  const words = text.split(' ')
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) { out.push(cur.trim()); cur = w } else cur += ' ' + w
    if (out.length === lines) break
  }
  if (out.length < lines && cur.trim()) out.push(cur.trim())
  if (out.length === lines && words.join(' ').length > out.join(' ').length) out[lines - 1] = out[lines - 1].replace(/.{0,2}$/, '…')
  return out
}

export default function SpsFlowchart({ steps, title }: { steps: Step[]; title?: string }) {
  const layout = useMemo(() => {
    let y = 92                                     // below the start circle
    return steps.map((s) => {
      const decision = s.step_type === 'decision'
      const lines = wrap(plain(s.action), decision ? 34 : CHARS, decision ? 2 : 3)
      const h = decision ? 74 : Math.max(46, lines.length * LINE_H + 22)
      const row = { s, y, h, lines, decision }
      y += h + ROW_GAP
      return row
    })
  }, [steps])

  if (!steps.length) return null
  const endY = (layout.at(-1)?.y ?? 92) + (layout.at(-1)?.h ?? 0) + ROW_GAP
  const H = endY + 70
  const cx = SHAPE_X + SHAPE_W / 2
  const totalT = steps.reduce((n, s) => n + (Number(s.time_days) || 0), 0)
  const staff = new Set(steps.map((s) => plain(s.actor)).filter((a) => a && !CITIZEN.test(a))).size
  const byNumber = new Map(layout.map((r) => [r.s.step_number, r]))
  let loopOffset = 0

  return (
    <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
      <svg data-diagram xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', margin: '0 auto', fontFamily: 'inherit' }}>
        <defs>
          <marker id="sps-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#374151" />
          </marker>
        </defs>
        <rect width={W} height={H} fill="#fff" />
        {title && <text x={12} y={22} fontSize={13} fontWeight={600} fill="#111827">{title}</text>}

        {/* totals (মোট ধাপ / সম্পৃক্ত জনবল / মোট সময়) */}
        {[['Total steps · মোট ধাপ', `${steps.length}`], ['Staff · সম্পৃক্ত জনবল', `${staff}`], ['Total time · মোট সময়', `${totalT} days`]].map(([k, v], i) => (
          <g key={k}>
            <rect x={PT_X + 36} y={10 + i * 22} width={130} height={22} fill="#f9fafb" stroke="#9ca3af" />
            <rect x={PT_X + 166} y={10 + i * 22} width={70} height={22} fill="#fff" stroke="#9ca3af" />
            <text x={PT_X + 42} y={25 + i * 22} fontSize={10.5} fill="#374151">{k}</text>
            <text x={PT_X + 172} y={25 + i * 22} fontSize={11} fontWeight={600} fill="#111827">{v}</text>
          </g>
        ))}

        {/* start */}
        <ellipse cx={cx} cy={46} rx={46} ry={22} fill="#fff" stroke="#111827" strokeWidth={1.4} />
        <text x={cx} y={50} fontSize={12} textAnchor="middle" fill="#111827">Start · শুরু</text>
        <line x1={cx} y1={68} x2={cx} y2={layout[0].y - 2} stroke="#374151" markerEnd="url(#sps-arrow)" />

        {layout.map((r, i) => {
          const { s, y, h, lines, decision } = r
          const next = layout[i + 1]
          const midY = y + h / 2
          const doc = s.step_type === 'document'
          const textY = midY - ((lines.length - 1) * LINE_H) / 2 + 4
          // "No" of a decision loops back on the left to the step it returns to
          const target = decision && s.no_goto ? byNumber.get(s.no_goto) : undefined
          const lx = SHAPE_X - 18 - (loopOffset += target ? 7 : 0) % 28
          return (
            <g key={s.step_number}>
              <rect x={NUM_X} y={midY - 15} width={NUM_W} height={30} fill="#fff" stroke="#6b7280" />
              <text x={NUM_X + NUM_W / 2} y={midY + 4} fontSize={11.5} textAnchor="middle" fill="#111827">{s.step_number}</text>

              {decision ? (
                <polygon points={`${cx},${y} ${SHAPE_X + SHAPE_W},${midY} ${cx},${y + h} ${SHAPE_X},${midY}`} fill="#fff" stroke="#111827" strokeWidth={1.3} />
              ) : doc ? (
                <path d={`M${SHAPE_X},${y} H${SHAPE_X + SHAPE_W} V${y + h - 8} C${SHAPE_X + SHAPE_W * 0.75},${y + h + 6} ${SHAPE_X + SHAPE_W * 0.25},${y + h - 22} ${SHAPE_X},${y + h - 6} Z`} fill="#fff" stroke="#111827" strokeWidth={1.3} />
              ) : (
                <rect x={SHAPE_X} y={y} width={SHAPE_W} height={h} fill="#fff" stroke="#111827" strokeWidth={1.3} />
              )}
              {lines.map((l, li) => (
                <text key={li} x={cx} y={textY + li * LINE_H} fontSize={12} textAnchor="middle" fill="#111827">{l}</text>
              ))}

              {s.step_type === 'message' && (
                <g transform={`translate(${SHAPE_X + SHAPE_W + 8}, ${midY - 8})`}>
                  <rect width={22} height={16} rx={2} fill="#fff" stroke="#374151" />
                  <path d="M0,0 L11,9 L22,0" fill="none" stroke="#374151" />
                </g>
              )}
              {s.visit && <text x={SHAPE_X + SHAPE_W + 8} y={y + 12} fontSize={11} fill="#b45309">🚶</text>}

              {/* P / T */}
              <rect x={PT_X} y={midY - 22} width={22} height={22} fill="#f9fafb" stroke="#6b7280" />
              <rect x={PT_X + 22} y={midY - 22} width={PT_W - 22} height={22} fill="#fff" stroke="#6b7280" />
              <rect x={PT_X} y={midY} width={22} height={22} fill="#f9fafb" stroke="#6b7280" />
              <rect x={PT_X + 22} y={midY} width={PT_W - 22} height={22} fill="#fff" stroke="#6b7280" />
              <text x={PT_X + 11} y={midY - 7} fontSize={11} fontWeight={700} textAnchor="middle" fill="#111827">P</text>
              <text x={PT_X + 11} y={midY + 15} fontSize={11} fontWeight={700} textAnchor="middle" fill="#111827">T</text>
              <text x={PT_X + 28} y={midY - 7} fontSize={11} fill="#111827">{wrap(plain(s.actor), 32, 1)[0] ?? ''}</text>
              <text x={PT_X + 28} y={midY + 15} fontSize={11} fill="#111827">
                {s.time_days === undefined || s.time_days === null || s.time_days === '' ? '—' : Number(s.time_days) === 0 ? 'Same day · একই দিন' : `${s.time_days} day${Number(s.time_days) === 1 ? '' : 's'}`}
              </text>

              {/* down to the next step (Yes for a decision) */}
              <line x1={cx} y1={y + h} x2={cx} y2={(next ? next.y : endY) - 2} stroke="#374151" markerEnd="url(#sps-arrow)" />
              {decision && <text x={cx + 8} y={y + h + 16} fontSize={11} fill="#15803d">Yes · হ্যাঁ</text>}

              {target && (
                <g>
                  <polyline
                    points={`${SHAPE_X},${midY} ${lx},${midY} ${lx},${target.y + target.h / 2} ${SHAPE_X - 2},${target.y + target.h / 2}`}
                    fill="none" stroke="#b91c1c" markerEnd="url(#sps-arrow)"
                  />
                  <text x={lx + 3} y={midY - 5} fontSize={11} fill="#b91c1c">No · না</text>
                </g>
              )}
            </g>
          )
        })}

        {/* end */}
        <circle cx={cx} cy={endY + 28} r={27} fill="#fff" stroke="#111827" strokeWidth={1.4} />
        <circle cx={cx} cy={endY + 28} r={23} fill="#fff" stroke="#111827" strokeWidth={2.4} />
        <text x={cx} y={endY + 32} fontSize={12} textAnchor="middle" fill="#111827">End · শেষ</text>
      </svg>
    </div>
  )
}
