import { useMemo, useState, useRef, useEffect, useCallback, type CSSProperties } from 'react'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer'
import type Canvas from 'diagram-js/lib/core/Canvas'
import 'bpmn-js/dist/assets/diagram-js.css'
import 'bpmn-js/dist/assets/bpmn-js.css'
import type { AsIsStep } from '@/api/projects'
import { toBpmnXml } from '@/utils/bpmnXml'

// The process drawn by bpmn-js (the bpmn.io renderer) from the same BPMN XML the
// ".bpmn" download carries: lanes per actor, gateways, and the rejection journey.

const ZOOM_STEP = 0.15
const ZOOM_MIN = 0.2
const ZOOM_MAX = 3.0

interface Props {
  steps: AsIsStep[]
  fullScreen?: boolean
  /** the pool's name */
  title?: string
}

export default function BpmnViewer({ steps, fullScreen, title }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<NavigatedViewer | null>(null)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState('')
  // the drawn diagram as a plain SVG (svg[data-diagram]) for the PNG / SVG downloads
  const [svg, setSvg] = useState('')

  const xml = useMemo(() => toBpmnXml(steps, title ?? 'Process'), [steps, title])
  const actors = useMemo(() => new Set(steps.map((s) => s.actor)).size, [steps])
  const decisions = useMemo(() => steps.filter((s) => s.step_type === 'decision' || (s as { if_rejected?: string }).if_rejected).length, [steps])

  const canvas = () => viewerRef.current?.get<Canvas>('canvas')

  useEffect(() => () => { viewerRef.current?.destroy(); viewerRef.current = null }, [])

  useEffect(() => {
    if (!containerRef.current || steps.length === 0) return
    // made on the first draw: the canvas is not on the page while there are no steps
    if (!viewerRef.current) {
      viewerRef.current = new NavigatedViewer({ container: containerRef.current })
      viewerRef.current.on('canvas.viewbox.changed', (e: { viewbox: { scale: number } }) => setZoom(e.viewbox.scale))
    }
    const viewer = viewerRef.current
    let live = true
    viewer.importXML(xml)
      .then(async () => {
        if (!live) return
        setError('')
        canvas()?.zoom('fit-viewport')
        const out = await viewer.saveSVG()
        if (live) setSvg(out.svg.slice(out.svg.indexOf('<svg')).replace('<svg', '<svg data-diagram'))
      })
      .catch((e: Error) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [xml, steps.length])

  const zoomTo = useCallback((z: number) => { canvas()?.zoom(Math.min(Math.max(+z.toFixed(2), ZOOM_MIN), ZOOM_MAX)) }, [])
  const zoomFit = useCallback(() => { canvas()?.zoom('fit-viewport') }, [])

  if (steps.length === 0) return null

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

        <button onClick={() => zoomTo(zoom - ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}
          style={btnStyle(zoom <= ZOOM_MIN)} title="Zoom out (Ctrl+scroll)" aria-label="Zoom out">
          <ZoomOut size={15} strokeWidth={1.9} />
        </button>

        <button onClick={() => zoomTo(1)}
          style={{ ...btnStyle(false), minWidth: 54, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
          title="Reset zoom to 100%">
          {Math.round(zoom * 100)}%
        </button>

        <button onClick={() => zoomTo(zoom + ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}
          style={btnStyle(zoom >= ZOOM_MAX)} title="Zoom in (Ctrl+scroll)" aria-label="Zoom in">
          <ZoomIn size={15} strokeWidth={1.9} />
        </button>

        <button onClick={zoomFit}
          style={{ ...btnStyle(false), marginLeft: 4, gap: 6, padding: '0 10px' }} title="Fit the whole diagram">
          <Maximize size={14} strokeWidth={1.9} /> Fit
        </button>

        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>
          {steps.length} steps · {actors} actors · {decisions} decisions · Ctrl+scroll to zoom · drag to pan
        </span>
      </div>

      {/* ── Canvas (bpmn-js) ───────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{
          ...(fullScreen ? { flex: 1, minHeight: 0 } : { height: 560 }),
          background: '#ffffff',
          borderLeft: '1px solid var(--line)',
          borderRight: '1px solid var(--line)',
          position: 'relative',
        }}
      />
      {error && <div style={{ padding: '8px 14px', fontSize: 12.5, color: '#c62828', borderLeft: '1px solid var(--line)', borderRight: '1px solid var(--line)' }}>The diagram could not be drawn: {error}</div>}
      <div style={{ display: 'none' }} dangerouslySetInnerHTML={{ __html: svg }} />

      {/* ── Legend ── */}
      <div style={{
        display: 'flex', gap: 16, padding: '7px 14px',
        background: 'white',
        flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)',
        border: '1px solid var(--line)',
        borderTop: 0,
        borderRadius: '0 0 10px 10px',
      }}>
        <Legend icon={<circle cx={7} cy={7} r={5.5} fill="#c8e6c9" stroke="#2e7d32" strokeWidth={1.5} />} label="Start" />
        <Legend icon={<circle cx={7} cy={7} r={5.5} fill="white" stroke="#222" strokeWidth={2.5} />} label="Service delivered" />
        <Legend icon={<path d="M7 1 L13 7 L7 13 L1 7 Z" fill="white" stroke="#222" strokeWidth={1.3} />} label="Decision (Yes / No)" />
        <Legend icon={<rect x={1} y={3} width={12} height={8} rx={2} fill="#ffcdd2" stroke="#c62828" strokeWidth={1.3} />} label="Rejection path" />
        <Legend icon={<circle cx={7} cy={7} r={5.5} fill="#ffcdd2" stroke="#c62828" strokeWidth={2.5} />} label="Application rejected" />
        <Legend icon={<rect x={1} y={3} width={12} height={8} rx={2} fill="#ffe0b2" stroke="#e65100" strokeWidth={1.3} />} label="Pain point" />
      </div>
    </>
  )
}

function Legend({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <svg width={14} height={14}>{icon}</svg>
      {label}
    </span>
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
