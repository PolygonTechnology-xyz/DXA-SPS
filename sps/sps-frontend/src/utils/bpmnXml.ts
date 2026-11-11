// BPMN 2.0 XML for a process: one lane per actor, steps as tasks in order, and the
// rejection journey — a decision step (or a TO-BE step with "if rejected") gets a
// gateway: "Yes" goes on, "No" goes back to its no_goto step, or to a "notify the
// applicant" task and a red "Application rejected" end. It carries the diagram layout
// (and bpmn.io colours) so it opens laid out in the app, Camunda Modeler and bpmn.io.

interface Step {
  step_number: number
  step_name?: string
  actor?: string
  action?: string
  time_days?: number
  pain_points?: string
  step_type?: string
  no_goto?: number
  if_rejected?: string
}

const MAIN_H = 150      // a lane's main row
const REJECT_H = 110    // the row under it, for a rejection branch
const LABEL_W = 30
const TASK_W = 150
const TASK_H = 80
const GW = 50
const GAP = 50
const EVENT = 36

const PAIN = { stroke: '#e65100', fill: '#ffe0b2' }
const REJECT = { stroke: '#c62828', fill: '#ffcdd2' }
const START = { stroke: '#2e7d32', fill: '#c8e6c9' }

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const plain = (t: unknown) => String(t ?? '').replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim()
const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t)

type Kind = 'start' | 'end' | 'task' | 'sendTask' | 'gateway'
interface Node {
  id: string
  kind: Kind
  name: string
  doc?: string
  lane: number
  /** main row, or the rejection row under it */
  row: 'main' | 'reject'
  x: number
  w: number
  h: number
  y: number
  color?: { stroke: string; fill: string }
}
interface Flow { id: string; source: string; target: string; name?: string; points: Array<{ x: number; y: number }> }

/** Does this step decide (and so can reject)? */
const decides = (s: Step) => s.step_type === 'decision' || !!plain(s.if_rejected)

export function toBpmnXml(steps: Step[], processName: string): string {
  const actors: string[] = []
  for (const s of steps) {
    const a = plain(s.actor) || 'Unassigned'
    if (!actors.includes(a)) actors.push(a)
  }
  const laneOf = (s: Step) => actors.indexOf(plain(s.actor) || 'Unassigned')
  const indexOf = new Map(steps.map((s, i) => [s.step_number, i]))

  // ── nodes, left to right ──
  const nodes: Node[] = []
  const flows: Array<Omit<Flow, 'points'>> = []
  const add = (n: Omit<Node, 'y'>) => { nodes.push({ ...n, y: 0 }); return n.id }
  const flow = (source: string, target: string, name?: string) => flows.push({ id: `Flow_${flows.length + 1}`, source, target, name })

  let x = LABEL_W * 2 + 40
  const first = steps.length ? laneOf(steps[0]) : 0
  let prev = add({ id: 'StartEvent_1', kind: 'start', name: 'Start', lane: first, row: 'main', x, w: EVENT, h: EVENT, color: START })
  x += EVENT + GAP
  const taskIds = steps.map((_, i) => `Task_${i + 1}`)
  const loops: Array<{ gateway: string; target: number }> = []
  // the "No" branches to an end, added after the main path so ids stay in order
  const rejects: Array<{ gateway: string; lane: number; x: number; text: string }> = []

  steps.forEach((s, i) => {
    const lane = laneOf(s)
    const name = `${s.step_number}. ${clip(plain(s.step_name) || plain(s.action).split(':')[0], 70)}${s.time_days != null ? ` (${s.time_days} d)` : ''}`
    const doc = [plain(s.action), plain(s.if_rejected) && `If rejected: ${plain(s.if_rejected)}`].filter(Boolean).join('\n')
    const id = add({
      id: taskIds[i], kind: s.step_type === 'message' ? 'sendTask' : 'task', name, doc, lane, row: 'main', x, w: TASK_W, h: TASK_H,
      color: plain(s.pain_points) ? PAIN : undefined,
    })
    flow(prev, id)
    prev = id
    x += TASK_W + GAP
    if (!decides(s)) return

    const gw = add({ id: `Gateway_${i + 1}`, kind: 'gateway', name: 'Approved?', lane, row: 'main', x, w: GW, h: GW })
    flow(id, gw)
    const back = s.no_goto != null ? indexOf.get(s.no_goto) : undefined
    if (back != null) loops.push({ gateway: gw, target: back })
    // under the gateway, ending left of the next step's "Yes" line
    else rejects.push({ gateway: gw, lane, x: x + GW + 20 - TASK_W, text: plain(s.if_rejected) })
    prev = gw
    x += GW + GAP
  })
  const last = steps.length ? laneOf(steps[steps.length - 1]) : 0
  const end = add({ id: 'EndEvent_1', kind: 'end', name: 'Service delivered', lane: last, row: 'main', x, w: EVENT, h: EVENT })
  // "Yes" on every flow that leaves a gateway along the main path
  for (const f of flows) if (f.source.startsWith('Gateway_')) f.name = 'Yes'
  flow(prev, end)
  if (prev.startsWith('Gateway_')) flows[flows.length - 1].name = 'Yes'

  for (const l of loops) flow(l.gateway, taskIds[l.target], 'No')
  rejects.forEach((r, k) => {
    const notify = add({
      id: `Notify_${k + 1}`, kind: 'sendTask', lane: r.lane, row: 'reject', x: r.x, w: TASK_W, h: TASK_H, color: REJECT,
      name: r.text ? clip(r.text.split(/(?<=[.;])\s/)[0], 80) : 'Notify the applicant of the rejection and the reason',
      doc: r.text || undefined,
    })
    const stop = add({ id: `RejectEnd_${k + 1}`, kind: 'end', name: 'Application rejected', lane: r.lane, row: 'reject', x: r.x - 40 - EVENT, w: EVENT, h: EVENT, color: REJECT })
    flow(r.gateway, notify, 'No')
    flow(notify, stop)
  })

  // ── lanes: a lane with a rejection branch gets a second row ──
  const hasReject = actors.map((_, li) => nodes.some((n) => n.lane === li && n.row === 'reject'))
  const laneH = (li: number) => MAIN_H + (hasReject[li] ? REJECT_H : 0)
  const laneTop: number[] = []
  actors.reduce((top, _, li) => { laneTop.push(top); return top + laneH(li) }, 0)
  for (const n of nodes) {
    const rowMid = laneTop[n.lane] + (n.row === 'main' ? MAIN_H / 2 : MAIN_H + REJECT_H / 2)
    n.y = rowMid - n.h / 2
  }
  const width = Math.max(...nodes.map((n) => n.x + n.w)) + GAP
  const height = laneTop.length ? laneTop[laneTop.length - 1] + laneH(actors.length - 1) : MAIN_H
  const byId = new Map(nodes.map((n) => [n.id, n]))

  // ── edges ──
  let loopCount = 0
  const route = (f: Omit<Flow, 'points'>): Flow => {
    const s = byId.get(f.source)!, t = byId.get(f.target)!
    const sMid = { x: s.x + s.w / 2, y: s.y + s.h / 2 }
    const tMid = { x: t.x + t.w / 2, y: t.y + t.h / 2 }
    // down from a gateway into its rejection task; on (leftwards) to the rejected end
    if (t.row === 'reject' && s.kind === 'gateway') return { ...f, points: [{ x: sMid.x, y: s.y + s.h }, { x: sMid.x, y: t.y }] }
    if (t.row === 'reject') return { ...f, points: [{ x: s.x, y: sMid.y }, { x: t.x + t.w, y: tMid.y }] }
    // a loop back (or skip ahead): under the gateway's main row, then into the target
    if (f.name === 'No') {
      const y = laneTop[s.lane] + MAIN_H - 10 - 7 * (loopCount++ % 4)
      const into = t.lane > s.lane ? t.y : t.y + t.h
      return { ...f, points: [{ x: sMid.x, y: s.y + s.h }, { x: sMid.x, y }, { x: tMid.x, y }, { x: tMid.x, y: into }] }
    }
    const p1 = { x: s.x + s.w, y: sMid.y }
    const p2 = { x: t.x, y: tMid.y }
    if (p1.y === p2.y) return { ...f, points: [p1, p2] }
    // out of a gateway, turn just before the target — clear of the rejection task under it
    const mid = s.kind === 'gateway' ? p2.x - 15 : Math.round((p1.x + p2.x) / 2)
    return { ...f, points: [p1, { x: mid, y: p1.y }, { x: mid, y: p2.y }, p2] }
  }
  const routed = flows.map(route)

  // ── XML ──
  const lanes = actors.map((a, li) => {
    const refs = nodes.filter((n) => n.lane === li).map((n) => n.id)
    return `      <bpmn:lane id="Lane_${li + 1}" name="${esc(a)}">\n${refs.map((r) => `        <bpmn:flowNodeRef>${r}</bpmn:flowNodeRef>`).join('\n')}\n      </bpmn:lane>`
  }).join('\n')

  const io = (id: string) => [
    ...routed.filter((f) => f.target === id).map((f) => `      <bpmn:incoming>${f.id}</bpmn:incoming>`),
    ...routed.filter((f) => f.source === id).map((f) => `      <bpmn:outgoing>${f.id}</bpmn:outgoing>`),
  ].join('\n')
  const tag: Record<Kind, string> = { start: 'startEvent', end: 'endEvent', task: 'task', sendTask: 'sendTask', gateway: 'exclusiveGateway' }
  const elements = nodes.map((n) => {
    const doc = n.doc ? `      <bpmn:documentation>${esc(n.doc)}</bpmn:documentation>\n` : ''
    return `    <bpmn:${tag[n.kind]} id="${n.id}" name="${esc(n.name)}">\n${doc}${io(n.id)}\n    </bpmn:${tag[n.kind]}>`
  }).join('\n')

  const color = (c?: { stroke: string; fill: string }) => (c ? ` bioc:stroke="${c.stroke}" bioc:fill="${c.fill}"` : '')
  const shape = (id: string, b: { x: number; y: number; w: number; h: number }, extra = '') =>
    `      <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${extra}>\n        <dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" />\n      </bpmndi:BPMNShape>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn" exporter="SPS" exporterVersion="1.1">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_1" name="${esc(processName)}" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" name="${esc(processName)}" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1">
${lanes}
    </bpmn:laneSet>
${elements}
${routed.map((f) => `    <bpmn:sequenceFlow id="${f.id}"${f.name ? ` name="${f.name}"` : ''} sourceRef="${f.source}" targetRef="${f.target}" />`).join('\n')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1">
${shape('Participant_1', { x: 0, y: 0, w: width, h: height }, ' isHorizontal="true"')}
${actors.map((_, li) => shape(`Lane_${li + 1}`, { x: LABEL_W, y: laneTop[li], w: width - LABEL_W, h: laneH(li) }, ' isHorizontal="true"')).join('\n')}
${nodes.map((n) => shape(n.id, n, (n.kind === 'gateway' ? ' isMarkerVisible="true"' : '') + color(n.color))).join('\n')}
${routed.map((f) => `      <bpmndi:BPMNEdge id="${f.id}_di" bpmnElement="${f.id}"${byId.get(f.target)!.row === 'reject' || (f.name === 'No') ? color({ stroke: REJECT.stroke, fill: REJECT.fill }) : ''}>\n${f.points.map((p) => `        <di:waypoint x="${p.x}" y="${p.y}" />`).join('\n')}\n      </bpmndi:BPMNEdge>`).join('\n')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`
}
