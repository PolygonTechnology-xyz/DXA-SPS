import type { Project } from '@/api/projects'

// A project's progress through the four SPS stages — the project cards and the Overview
// show the same thing.

export type StageState = 'done' | 'review' | 'todo'
export interface Stage { key: 'asis' | 'asis_ok' | 'tobe' | 'tobe_ok'; label: string; state: StageState }

export const ASIS_APPROVED = ['asis_approved', 'tobe_complete', 'tobe_approved']

/** AS-IS mapped → approved → TO-BE designed → approved. An approval waiting on the user is "To review". */
export function stagesOf(p: Project): Stage[] {
  const done = [
    (p.asis_steps?.length ?? 0) > 0,
    ASIS_APPROVED.includes(p.status),
    (p.tobe_steps?.length ?? 0) > 0,
    p.status === 'tobe_approved',
  ]
  const meta = [
    { key: 'asis', label: 'AS-IS mapped' },
    { key: 'asis_ok', label: 'AS-IS approved' },
    { key: 'tobe', label: 'TO-BE designed' },
    { key: 'tobe_ok', label: 'TO-BE approved' },
  ] as const
  const next = done.findIndex((d) => !d)
  return meta.map((m, i) => ({
    ...m,
    // an approval stage is the user's turn as soon as what it approves exists
    state: done[i] ? 'done' : i === next && (i === 1 || i === 3) ? 'review' : 'todo',
  }))
}

/** Web/AI findings that wait for the user's answer */
export const pendingFindings = (p: Project) => (p.asis_findings ?? []).filter((f) => f.status === 'pending').length

/** What waits for the user: findings to decide, and an approval */
export function needsOf(p: Project, stages = stagesOf(p)): number {
  return pendingFindings(p) + (stages.some((s) => s.state === 'review') ? 1 : 0)
}
