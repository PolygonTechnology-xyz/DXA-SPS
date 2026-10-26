import { useMemo, useState, useRef, useEffect, useCallback, type CSSProperties } from 'react'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import type { AsIsStep } from '@/api/projects'

// Layout constants (in SVG coordinate units)
const BOX_W = 160
const BOX_H = 72
const H_GAP = 56
const LANE_H = 116
const LABEL_W = 160
const PAD_V = 32
const EVT_R = 14
const EVT_PAD = 18

const LANE_FILLS = [
  '#eff6ff', '#f0fdf4', '#fefce8', '#fff7ed',
  '#fdf4ff', '#f0f9ff', '#fff1f2', '#f0fdfa',
]
const LANE_STROKES = [
  '#93c5fd', '#86efac', '#fde047', '#fdba74',
  '#e879f9', '#7dd3fc', '#fda4af', '#5eead4',
]

const ZOOM_STEP = 0.15
const ZOOM_MIN = 0.2
const ZOOM_MAX = 3.0

interface Props {
  steps: AsIsStep[]
  fullScreen?: boolean
}

export default function BpmnViewer({ steps, fullScreen }: Props) {
  const [zoom, setZoom] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(800)
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, sl: 0, st: 0 })

  // Measure container to compute auto-fit zoom
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth))
    ro.observe(el)
    setContainerW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const actors = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const s of steps) {
      if (!seen.has(s.actor)) { seen.add(s.actor); list.push(s.actor) }
    }
    return list
  }, [steps])

  const actorIdx = useMemo(() => {
    const m: Record<string, number> = {}
    actors.forEach((a, i) => { m[a] = i })
    return m
  }, [actors])

  const n = steps.length
  if (n === 0) return null

  // SVG coordinate system dimensions
  const contentX = LABEL_W + EVT_PAD + EVT_R * 2 + EVT_PAD
  const totalW = contentX + n * (BOX_W + H_GAP) - H_GAP + EVT_PAD + EVT_R * 2 + EVT_PAD
  const totalH = PAD_V + actors.length * LANE_H + PAD_V

  // Rendered pixel dimensions (zoom applied)
  const rendW = Math.round(totalW * zoom)
  const rendH = Math.round(totalH * zoom)

  const zoomIn = useCallback(() => setZoom(z => Math.min(+(z + ZOOM_STEP).toFixed(2), ZOOM_MAX)), [])
  const zoomOut = useCallback(() => setZoom(z => Math.max(+(z - ZOOM_STEP).toFixed(2), ZOOM_MIN)), [])
  const zoomReset = useCallback(() => setZoom(1), [])
  const zoomFit = useCallback(() => {
    const fit = (containerW - 4) / totalW   // 4px for border
    setZoom(Math.min(Math.max(+(fit).toFixed(2), ZOOM_MIN), ZOOM_MAX))
  }, [containerW, totalW])

  // Ctrl+wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    if (e.deltaY < 0) setZoom(z => Math.min(+(z + ZOOM_STEP).toFixed(2), ZOOM_MAX))
    else setZoom(z => Math.max(+(z - ZOOM_STEP).toFixed(2), ZOOM_MIN))
  }, [])

  // Click-and-drag panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    isPanning.current = true
    panStart.current = {
      x: e.clientX, y: e.clientY,
      sl: containerRef.current?.scrollLeft ?? 0,
      st: containerRef.current?.scrollTop ?? 0,
    }
    e.currentTarget.setAttribute('data-panning', '1')
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current || !containerRef.current) return
    containerRef.current.scrollLeft = panStart.current.sl - (e.clientX - panStart.current.x)
    containerRef.current.scrollTop  = panStart.current.st - (e.clientY - panStart.current.y)
  }, [])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    isPanning.current = false
    e.currentTarget.removeAttribute('data-panning')
  }, [])

  // Step helpers
  const bx = (i: number) => contentX + i * (BOX_W + H_GAP)
  const by = (actor: string) => PAD_V + actorIdx[actor] * LANE_H + (LANE_H - BOX_H) / 2
  const lcy = (actor: string) => PAD_V + actorIdx[actor] * LANE_H + LANE_H / 2

  const startX = LABEL_W + EVT_PAD + EVT_R
  const endX = contentX + (n - 1) * (BOX_W + H_GAP) + BOX_W + EVT_PAD + EVT_R
  const midY = PAD_V + (actors.length * LANE_H) / 2

  return (
    <>
      {/* ── Toolbar ────────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 12px',
        background: 'var(--surface)', flexWrap: 'wrap',
        border: '1px solid var(--line)',
        borderRadius: '10px 10px 0 0',
      }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: 4 }}>Zoom</span>

        <button onClick={zoomOut} disabled={zoom <= ZOOM_MIN}
          style={btnStyle(zoom <= ZOOM_MIN)} title="Zoom out (Ctrl+scroll)" aria-label="Zoom out">
          <ZoomOut size={15} strokeWidth={1.9} />
        </button>

        <button onClick={zoomReset}
          style={{ ...btnStyle(false), minWidth: 54, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
          title="Reset zoom to 100%">
          {Math.round(zoom * 100)}%
        </button>

        <button onClick={zoomIn} disabled={zoom >= ZOOM_MAX}
          style={btnStyle(zoom >= ZOOM_MAX)} title="Zoom in (Ctrl+scroll)" aria-label="Zoom in">
          <ZoomIn size={15} strokeWidth={1.9} />
        </button>

        <button onClick={zoomFit}
          style={{ ...btnStyle(false), marginLeft: 4, gap: 6, padding: '0 10px' }} title="Fit diagram to window width">
          <Maximize size={14} strokeWidth={1.9} /> Fit
        </button>

        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>
          {n} steps · {actors.length} actors · Ctrl+scroll or use buttons to zoom · scroll to pan
        </span>
      </div>

      {/* ── Scrollable canvas ──────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          overflowX: 'scroll',
          overflowY: 'auto',
          ...(fullScreen ? { flex: 1, minHeight: 0 } : { maxHeight: 560 }),
          background: '#f8fafc',
          cursor: 'grab',
          WebkitOverflowScrolling: 'touch',
          userSelect: 'none',
          borderLeft: '1px solid var(--line)',
          borderRight: '1px solid var(--line)',
        }}
      >
        {/* Explicit-width wrapper forces the scroll container to overflow-scroll.
            SVG width attributes alone can still be squeezed by block layout. */}
        <div style={{ width: rendW, height: rendH, flexShrink: 0 }}>
        <svg
          data-diagram
          viewBox={`0 0 ${totalW} ${totalH}`}
          width={rendW}
          height={rendH}
          style={{ display: 'block' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <marker id="bpmn-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
              <path d="M 0 0 L 7 3.5 L 0 7 Z" fill="#94a3b8" />
            </marker>
            <filter id="bpmn-shadow" x="-8%" y="-8%" width="120%" height="130%">
              <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#00000018" />
            </filter>
          </defs>

          {/* ── Swimlane backgrounds ── */}
          {actors.map((actor, i) => (
            <g key={actor}>
              <rect
                x={0} y={PAD_V + i * LANE_H}
                width={totalW} height={LANE_H}
                fill={LANE_FILLS[i % LANE_FILLS.length]}
                stroke={LANE_STROKES[i % LANE_STROKES.length]}
                strokeWidth={0.5}
              />
              <rect
                x={0} y={PAD_V + i * LANE_H}
                width={LABEL_W} height={LANE_H}
                fill={LANE_STROKES[i % LANE_STROKES.length]}
                opacity={0.28}
              />
              <line
                x1={LABEL_W} y1={PAD_V + i * LANE_H}
                x2={LABEL_W} y2={PAD_V + (i + 1) * LANE_H}
                stroke={LANE_STROKES[i % LANE_STROKES.length]}
                strokeWidth={1}
              />
              <ActorLabel text={actor} cx={LABEL_W / 2} cy={PAD_V + i * LANE_H + LANE_H / 2} />
            </g>
          ))}

          {/* ── Flow arrows ── */}
          <FlowArrow x1={startX + EVT_R} y1={midY} x2={bx(0)} y2={lcy(steps[0].actor)} />

          {steps.slice(0, -1).map((step, i) => (
            <FlowArrow
              key={`flow-${i}`}
              x1={bx(i) + BOX_W} y1={lcy(step.actor)}
              x2={bx(i + 1)} y2={lcy(steps[i + 1].actor)}
            />
          ))}

          <FlowArrow x1={bx(n - 1) + BOX_W} y1={lcy(steps[n - 1].actor)} x2={endX - EVT_R} y2={midY} />

          {/* ── Start event ── */}
          <circle cx={startX} cy={midY} r={EVT_R} fill="white" stroke="#16a34a" strokeWidth={2.5} filter="url(#bpmn-shadow)" />
          <circle cx={startX} cy={midY} r={EVT_R - 5} fill="#16a34a" opacity={0.22} />
          <text x={startX} y={midY + EVT_R + 13} textAnchor="middle" fontSize={9} fill="#16a34a" fontWeight={600}>START</text>

          {/* ── Step boxes ── */}
          {steps.map((step, i) => {
            const ai = actorIdx[step.actor]
            return (
              <StepBox
                key={step.step_number}
                x={bx(i)} y={by(step.actor)}
                w={BOX_W} h={BOX_H}
                stepNum={step.step_number}
                name={shortLabel(step.step_name ?? step.action)}
                timeDays={step.time_days}
                hasPain={!!step.pain_points}
                stroke={LANE_STROKES[ai % LANE_STROKES.length]}
                fill={LANE_FILLS[ai % LANE_FILLS.length]}
              />
            )
          })}

          {/* ── End event ── */}
          <circle cx={endX} cy={midY} r={EVT_R} fill="white" stroke="#dc2626" strokeWidth={3} filter="url(#bpmn-shadow)" />
          <circle cx={endX} cy={midY} r={EVT_R - 4} fill="white" stroke="#dc2626" strokeWidth={1.5} />
          <circle cx={endX} cy={midY} r={EVT_R - 8} fill="#dc2626" opacity={0.8} />
          <text x={endX} y={midY + EVT_R + 13} textAnchor="middle" fontSize={9} fill="#dc2626" fontWeight={600}>END</text>
        </svg>
        </div>{/* end explicit-width wrapper */}
      </div>

      {/* ── Legend ── */}
      <div style={{
        display: 'flex', gap: 16, padding: '7px 14px',
        background: 'white',
        flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)',
        border: '1px solid var(--line)',
        borderTop: 0,
        borderRadius: '0 0 10px 10px',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width={12} height={12}><circle cx={6} cy={6} r={5} fill="white" stroke="#16a34a" strokeWidth={2} /></svg>
          Start
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width={12} height={12}><circle cx={6} cy={6} r={5} fill="white" stroke="#dc2626" strokeWidth={2} /><circle cx={6} cy={6} r={2.5} fill="#dc2626" /></svg>
          End
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width={12} height={12}><circle cx={6} cy={6} r={4.5} fill="#f87171" /></svg>
          Pain point
        </span>
      </div>
    </>
  )
}

// ── Zoom button style ─────────────────────────────────────────────────────────

function btnStyle(disabled: boolean): CSSProperties {
  return {
    border: '1px solid var(--line)',
    background: 'var(--surface)',
    borderRadius: 7,
    padding: '0 8px',
    height: 30,
    minWidth: 30,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    color: 'var(--ink-2)',
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FlowArrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const sameY = Math.abs(y1 - y2) < 2
  const d = sameY
    ? `M ${x1} ${y1} H ${x2}`
    : `M ${x1} ${y1} C ${x1 + 44} ${y1}, ${x2 - 44} ${y2}, ${x2} ${y2}`
  return (
    <path d={d} fill="none" stroke="#94a3b8" strokeWidth={1.5} markerEnd="url(#bpmn-arrow)" />
  )
}

function ActorLabel({ text, cx, cy }: { text: string; cx: number; cy: number }) {
  const MAX = 22
  const label = text.length > MAX ? text.slice(0, MAX - 1) + '…' : text
  // Split on ' / ' or long single words for two-line wrapping
  const parts = label.includes(' / ') ? label.split(' / ') : [label]
  return (
    <text
      x={cx} y={cy}
      textAnchor="middle" dominantBaseline="middle"
      fontSize={10.5} fontWeight={600} fill="#374151"
      style={{ userSelect: 'none' }}
    >
      {parts.length > 1 ? (
        <>
          <tspan x={cx} dy="-7">{parts[0]}</tspan>
          <tspan x={cx} dy="14">/ {parts[1]}</tspan>
        </>
      ) : (
        label
      )}
    </text>
  )
}

function StepBox({
  x, y, w, h, stepNum, name, timeDays, hasPain, stroke, fill,
}: {
  x: number; y: number; w: number; h: number
  stepNum: number; name: string; timeDays?: number; hasPain?: boolean
  stroke: string; fill: string
}) {
  const BADGE_W = 28
  const lines = wrapText(name, w - BADGE_W - 10, 11, 3)

  return (
    <g filter="url(#bpmn-shadow)">
      <rect x={x} y={y} width={w} height={h} rx={8} ry={8} fill="white" stroke={stroke} strokeWidth={1.5} />
      <rect x={x} y={y} width={BADGE_W} height={h} rx={8} ry={8} fill={fill} />
      <rect x={x + BADGE_W - 8} y={y} width={8} height={h} fill={fill} />
      <text x={x + BADGE_W / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="middle"
        fontSize={11} fontWeight={700} fill="#374151">{stepNum}</text>

      {lines.map((line, i) => (
        <text
          key={i}
          x={x + BADGE_W + 7}
          y={y + (h / 2) - ((lines.length - 1) * 7.5) + i * 15}
          fontSize={11} fill="#1e293b" dominantBaseline="middle"
        >
          {line}
        </text>
      ))}

      {timeDays != null && (
        <text x={x + w - 5} y={y + h - 5} textAnchor="end" fontSize={9} fill="#64748b">
          {timeDays}d
        </text>
      )}

      {hasPain && (
        <circle cx={x + w - 8} cy={y + 8} r={4.5} fill="#f87171" />
      )}
    </g>
  )
}

// If action follows "Label: Description" format, return only the label for compact display
function shortLabel(text: string): string {
  const clean = text.replace(/\[\d+\]/g, '').trim()
  const idx = clean.indexOf(':')
  return idx > 0 && idx <= 40 ? clean.slice(0, idx).trim() : clean
}

function wrapText(text: string, maxW: number, fontSize: number, maxLines: number): string[] {
  const charsPerLine = Math.floor(maxW / (fontSize * 0.62))
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (lines.length >= maxLines) break
    const test = current ? `${current} ${word}` : word
    if (test.length <= charsPerLine) {
      current = test
    } else {
      if (current) lines.push(current)
      current = word.length > charsPerLine ? word.slice(0, charsPerLine - 1) + '…' : word
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  if (lines.length === maxLines && current !== lines[maxLines - 1]) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…'
  }
  return lines
}
