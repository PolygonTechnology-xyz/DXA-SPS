import { startJob, endJob, runningJob, type JobKind } from "../services/jobs";
import { cors } from "./cors";
import { log } from "./log";

/** streamSse for a long AI run on a project: one at a time, reported by the project API while it runs */
export function streamJob(projectId: string, kind: JobKind, fn: (emit: (data: object) => void, heartbeat: () => void) => Promise<void>): Response {
  return streamSse(async (emit, heartbeat) => {
    if (!startJob(projectId, kind)) {
      // not an error: the page simply follows the run already going
      emit({ type: "busy", running: runningJob(projectId) });
      return;
    }
    try { await fn(emit, heartbeat); } finally { endJob(projectId); }
  });
}

export function streamSse(fn: (emit: (data: object) => void, heartbeat: () => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        const d = data as Record<string, unknown>
        // Summarise the event concisely for the log
        const type = d.type as string
        if (type === "text") {
          log.sse(`→ text (${String(d.text ?? "").length} chars)`)
        } else if (type === "tool_started") {
          log.sse(`→ tool_started  name=${d.name}  input=${JSON.stringify(d.input).slice(0, 80)}`)
        } else if (type === "step_updated") {
          log.sse(`→ step_updated  step_type=${d.step_type}  steps=${(d.steps as unknown[])?.length ?? "?"}`)
        } else if (type === "action") {
          log.sse(`→ action  name=${d.name}  payload=${JSON.stringify(d.payload).slice(0, 80)}`)
        } else if (type === "error") {
          log.error(`→ SSE error: ${d.message}`)
        } else if (type !== "done" && type !== "progress") {
          log.sse(`→ ${type}  ${JSON.stringify(d).slice(0, 100)}`)
        } else {
          log.sse(`→ ${type}`)
        }
        // the browser may have gone (reload, closed tab): the work goes on and is saved
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { /* stream already closed */ }
      };
      const heartbeat = () => {
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { /* stream already closed */ }
      };
      const keepAlive = setInterval(heartbeat, 8000);
      try {
        await fn(emit, heartbeat);
      } catch (err) {
        log.error(`streamSse uncaught: ${String(err)}`);
        emit({ type: "error", message: String(err) });
      } finally {
        clearInterval(keepAlive);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, {
    headers: cors(new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      // nginx (ingress and the frontend's proxy): pass each event on at once, never buffer
      "X-Accel-Buffering": "no",
    })),
  });
}
