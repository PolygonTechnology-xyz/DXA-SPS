// BPMN 2.0 XML for a process (one lane per actor, steps as tasks in order), with
// diagram layout so it opens laid out in Camunda Modeler, bpmn.io and similar tools.

interface Step { step_number: number; step_name?: string; actor?: string; action?: string }

const LANE_H = 120
const LABEL_W = 30
const TASK_W = 140
const TASK_H = 80
const GAP = 50
const EVENT = 36

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const plain = (t: unknown) => String(t ?? '').replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim()

export function toBpmnXml(steps: Step[], processName: string): string {
  const actors: string[] = []
  for (const s of steps) {
    const a = plain(s.actor) || 'Unassigned'
    if (!actors.includes(a)) actors.push(a)
  }
  const laneOf = (s: Step) => actors.indexOf(plain(s.actor) || 'Unassigned')
  const width = LABEL_W + GAP + EVENT + GAP + steps.length * (TASK_W + GAP) + EVENT + GAP
  const height = actors.length * LANE_H

  // positions
  const taskX = (i: number) => LABEL_W + GAP + EVENT + GAP + i * (TASK_W + GAP)
  const laneY = (lane: number) => lane * LANE_H
  const firstLane = steps.length ? laneOf(steps[0]) : 0
  const lastLane = steps.length ? laneOf(steps[steps.length - 1]) : 0
  const start = { x: LABEL_W + GAP, y: laneY(firstLane) + (LANE_H - EVENT) / 2 }
  const end = { x: taskX(steps.length), y: laneY(lastLane) + (LANE_H - EVENT) / 2 }
  const task = steps.map((s, i) => ({ id: `Task_${i + 1}`, x: taskX(i), y: laneY(laneOf(s)) + (LANE_H - TASK_H) / 2, lane: laneOf(s) }))

  const nodes = ['StartEvent_1', ...task.map((t) => t.id), 'EndEvent_1']
  const flows = nodes.slice(1).map((target, i) => ({ id: `Flow_${i + 1}`, source: nodes[i], target }))
  const box = (id: string) => {
    if (id === 'StartEvent_1') return { x: start.x, y: start.y, w: EVENT, h: EVENT }
    if (id === 'EndEvent_1') return { x: end.x, y: end.y, w: EVENT, h: EVENT }
    const t = task.find((x) => x.id === id)!
    return { x: t.x, y: t.y, w: TASK_W, h: TASK_H }
  }
  const waypoints = (a: string, b: string) => {
    const s = box(a), t = box(b)
    const p1 = { x: s.x + s.w, y: s.y + s.h / 2 }
    const p2 = { x: t.x, y: t.y + t.h / 2 }
    if (p1.y === p2.y) return [p1, p2]
    const mid = (p1.x + p2.x) / 2
    return [p1, { x: mid, y: p1.y }, { x: mid, y: p2.y }, p2]
  }

  const lanes = actors.map((a, li) => {
    const refs = [
      ...(li === firstLane ? ['StartEvent_1'] : []),
      ...task.filter((t) => t.lane === li).map((t) => t.id),
      ...(li === lastLane ? ['EndEvent_1'] : []),
    ]
    return `      <bpmn:lane id="Lane_${li + 1}" name="${esc(a)}">\n${refs.map((r) => `        <bpmn:flowNodeRef>${r}</bpmn:flowNodeRef>`).join('\n')}\n      </bpmn:lane>`
  }).join('\n')

  const incoming = (id: string) => flows.filter((f) => f.target === id).map((f) => `      <bpmn:incoming>${f.id}</bpmn:incoming>`).join('\n')
  const outgoing = (id: string) => flows.filter((f) => f.source === id).map((f) => `      <bpmn:outgoing>${f.id}</bpmn:outgoing>`).join('\n')
  const tasks = steps.map((s, i) => {
    const id = task[i].id
    const name = `${s.step_number}. ${plain(s.step_name) || plain(s.action).split(':')[0]}`
    return `    <bpmn:task id="${id}" name="${esc(name)}">
      <bpmn:documentation>${esc(plain(s.action))}</bpmn:documentation>
${incoming(id)}
${outgoing(id)}
    </bpmn:task>`
  }).join('\n')

  const shape = (id: string, b: { x: number; y: number; w: number; h: number }, extra = '') =>
    `      <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${extra}>\n        <dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" />\n      </bpmndi:BPMNShape>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn" exporter="SPS" exporterVersion="1.0">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_1" name="${esc(processName)}" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" name="${esc(processName)}" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1">
${lanes}
    </bpmn:laneSet>
    <bpmn:startEvent id="StartEvent_1" name="Start">
${outgoing('StartEvent_1')}
    </bpmn:startEvent>
${tasks}
    <bpmn:endEvent id="EndEvent_1" name="End">
${incoming('EndEvent_1')}
    </bpmn:endEvent>
${flows.map((f) => `    <bpmn:sequenceFlow id="${f.id}" sourceRef="${f.source}" targetRef="${f.target}" />`).join('\n')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1">
${shape('Participant_1', { x: 0, y: 0, w: width, h: height }, ' isHorizontal="true"')}
${actors.map((_, li) => shape(`Lane_${li + 1}`, { x: LABEL_W, y: laneY(li), w: width - LABEL_W, h: LANE_H }, ' isHorizontal="true"')).join('\n')}
${shape('StartEvent_1', box('StartEvent_1'))}
${task.map((t) => shape(t.id, box(t.id))).join('\n')}
${shape('EndEvent_1', box('EndEvent_1'))}
${flows.map((f) => `      <bpmndi:BPMNEdge id="${f.id}_di" bpmnElement="${f.id}">\n${waypoints(f.source, f.target).map((p) => `        <di:waypoint x="${p.x}" y="${p.y}" />`).join('\n')}\n      </bpmndi:BPMNEdge>`).join('\n')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`
}
