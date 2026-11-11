import Anthropic from "@anthropic-ai/sdk";
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "../../config";
import { log } from "../../utils/log";

// AS-IS failure diagnostics

/** "[1]" / "(W1)" / "[w1]" → "[W1]" when the model declared W-numbered web sources */
export function normalizeWebMarkers(steps: Array<Record<string, unknown>>, sources: Array<{ id?: string }> | undefined) {
  const ids = new Set((sources ?? []).map((x) => String(x.id ?? "").toUpperCase()).filter((x) => /^W\d+$/.test(x)));
  if (!ids.size) return;
  for (const st of steps) {
    for (const f of ["action", "input", "pain_points"]) {
      if (typeof st[f] !== "string") continue;
      st[f] = (st[f] as string)
        .replace(/\(\s*([Ww]\d+(?:\s*,\s*[Ww]\d+)*)\s*\)/g, "[$1]")
        .replace(/\[\s*(\d+(?:\s*,\s*\d+)*)\s*\]/g, (m, nums: string) => {
          const mapped = nums.split(",").map((n) => `W${n.trim()}`);
          return mapped.every((id) => ids.has(id)) ? `[${mapped.join(",")}]` : m;
        })
        .replace(/\[\s*w(\d+)/g, "[W$1");
    }
  }
}

export function blockSummary(content: Anthropic.ContentBlock[]): string {
  return content.map((b) => {
    const r = b as unknown as { type: string; content?: unknown };
    if (r.type === "web_search_tool_result") {
      const c = r.content as { error_code?: string } | unknown[];
      return `search(${Array.isArray(c) ? c.length : (c as { error_code?: string })?.error_code ?? "?"})`;
    }
    return r.type;
  }).join(",");
}

/** One JSON line per failed AS-IS pass in data/logs/asis-failures.log — readable later, unlike the terminal */
export function logFailure(projectId: string | undefined, detail: Record<string, unknown>) {
  try {
    const dir = join(DATA_DIR, "logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "asis-failures.log"), JSON.stringify({ at: new Date().toISOString(), project: projectId ?? null, ...detail }) + "\n");
  } catch (err) {
    log.error(`asis failure log: ${String(err)}`);
  }
}
