// Long AI runs per project (AS-IS mapping + review, TO-BE design). The project API reports
// the running one, so the UI keeps its pages locked — even after a reload — until it ends.

export type JobKind = "asis" | "tobe";

const running = new Map<string, { kind: JobKind; since: number }>();

export const runningJob = (projectId: string): JobKind | null => running.get(projectId)?.kind ?? null;

export function startJob(projectId: string, kind: JobKind): boolean {
  if (running.has(projectId)) return false;
  running.set(projectId, { kind, since: Date.now() });
  return true;
}

export const endJob = (projectId: string) => { running.delete(projectId); };
