import { mapAsis, reviewAsis, type AsisRequest } from "../services/analyze/asis";
import { generateTobe } from "../services/analyze/tobe";
import { draftSpsPlan } from "../services/analyze/sps-plan";
import { streamSse, streamJob } from "../utils/sse";
import { json } from "../utils/cors";

// The AI analysis routes. The work itself lives in services/analyze/:
//   asis.ts      map the AS-IS (documents first, web for gaps), then review it
//   tobe.ts      design the TO-BE, refine it, fill the SPS sheets
//   sps-plan.ts  draft the implementation plan
//   prompts.ts   the system prompts · steps.ts row parsing · diagnostics.ts failure logs

export async function handleAnalyze(req: Request, url: URL): Promise<Response> {
  if (req.method.toUpperCase() !== "POST") return json({ error: "not_found" }, 404);

  switch (url.pathname) {
    case "/api/analyze/asis": {
      const body = await req.json() as AsisRequest;
      return streamJob(body.project_id ?? `adhoc-${Date.now()}`, "asis", (emit) => mapAsis(body, emit));
    }
    case "/api/analyze/asis-review": {
      const body = await req.json() as { project_id: string };
      return streamJob(body.project_id, "asis", (emit) => reviewAsis(body.project_id, emit));
    }
    case "/api/analyze/tobe": {
      const body = await req.json() as { project_id: string };
      return streamJob(body.project_id, "tobe", (emit) => generateTobe(body.project_id, emit));
    }
    case "/api/analyze/sps-plan": {
      const body = await req.json() as { project_id: string };
      return streamSse((emit) => draftSpsPlan(body.project_id, emit));
    }
  }
  return json({ error: "not_found" }, 404);
}
