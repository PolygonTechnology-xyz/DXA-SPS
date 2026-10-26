import { db } from "../db/index";
import type { SpsData } from "./sps-calc";

// Read / update a project's SPS data (projects.sps). Updates merge section by section.

export function getSps(projectId: string): SpsData {
  const row = db.query("SELECT sps FROM projects WHERE id = ?").get(projectId) as { sps: string | null } | null;
  try { return row?.sps ? JSON.parse(row.sps) as SpsData : {}; } catch { return {}; }
}

export function updateSps(projectId: string, patch: Partial<SpsData>): SpsData {
  const next: SpsData = { ...getSps(projectId), ...patch };
  if (patch.settings) next.settings = { ...getSps(projectId).settings, ...patch.settings };
  db.query("UPDATE projects SET sps = ?, updated_at = unixepoch() WHERE id = ?").run(JSON.stringify(next), projectId);
  return next;
}

/** Short summary of the SPS data for prompts (what the agent should know) */
export function spsPromptBlock(projectId: string): string {
  const sps = getSps(projectId);
  const parts: string[] = [];
  if (sps.office && Object.values(sps.office).some(Boolean)) {
    parts.push(`Office (Matrix-1): ${[sps.office.ministry, sps.office.department, sps.office.office].filter(Boolean).join(" / ")}`);
  }
  if (sps.feedback?.respondents) {
    const low = Object.entries(sps.feedback.averages).sort((a, b) => a[1] - b[1]).slice(0, 5).map(([k, v]) => `${k} ${v}/5`).join(", ");
    parts.push(`Citizen feedback (Matrix-3, ${sps.feedback.respondents} respondents): total ${sps.feedback.total}/70; lowest: ${low}${sps.feedback.comments.length ? `; comments: ${sps.feedback.comments.slice(0, 8).join(" | ")}` : ""}`);
  }
  if (sps.profile && Object.keys(sps.profile).length) {
    parts.push(`Service delivery profile (Sheet-1): ${Object.entries(sps.profile).map(([k, v]) => `${k}=${v.value}`).join("; ")}`);
  }
  if (sps.documents?.length) {
    parts.push(`Documents (Sheet-3): ${sps.documents.map((d) => `${d.name} [${d.source === "other_office" ? "from another office" : "citizen has it"}; verified ${d.verify}]`).join("; ")}`);
  }
  return parts.length ? `\n\nSPS DATA:\n${parts.join("\n")}` : "";
}
