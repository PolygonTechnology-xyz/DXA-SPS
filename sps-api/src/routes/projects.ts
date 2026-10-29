import { db, parseProject, type Row } from "../db/index";
import { json, cors } from "../utils/cors";
import { nanoid } from "../utils/id";
import { setMemory } from "../services/memory";
import { runningJob } from "../services/jobs";
import { listVersions, getVersion, exportExcel, currentAsVersion } from "../services/outputs";
import { syncActive, ensureActive, versionList, openVersion, newVersion, activeInfo } from "../services/versions";
import { updateSps, getSps } from "../services/sps";
import { runChecks, checksBlocking, summariseFeedback, type SpsData } from "../services/sps-calc";
import { SPS_FEEDBACK } from "../services/sps-guide";
import { suggestGoal } from "../services/goal";
import { draftDigitalPlan, ensureDigitalPlan } from "../services/digital-plan";
import { applyDecisions, loadAsis, saveAsis, syncFindings, coverage, type Decision, type Step } from "../services/asis-state";

export async function handleProjects(req: Request, url: URL): Promise<Response> {
  const method = req.method.toUpperCase();

  if (method === "GET" && url.pathname === "/api/projects") {
    const rows = db.query("SELECT * FROM projects WHERE trashed = 0 ORDER BY updated_at DESC").all();
    return json(rows.map(parseProject));
  }

  if (method === "POST" && url.pathname === "/api/projects") {
    const body = await req.json() as Record<string, string>;
    const id = `proj_${nanoid()}`;
    // a goal from the assistant's proposal counts as its suggestion until the user edits it
    db.query(
      "INSERT INTO projects (id, name, description, goal, goal_by, country, ministry, department) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      id, body.name ?? "Untitled Project", body.description ?? "", body.goal ?? "", body.goal ? "assistant" : null,
      body.country?.trim() || "Bangladesh", body.ministry?.trim() ?? "", body.department?.trim() ?? "",
    );
    const row = db.query("SELECT * FROM projects WHERE id = ?").get(id);
    return json(parseProject(row as Row), 201);
  }

  // The user's consent on web/AI findings (buttons on the consent card)
  const decideMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/findings\/decide$/);
  if (method === "POST" && decideMatch) {
    const body = await req.json() as { decisions?: Decision[] };
    if (!body.decisions?.length) return json({ error: "no_decisions" }, 400);
    if (activeInfo(decideMatch[1])?.asis_locked) return json({ error: "locked", what: "asis" }, 409);
    const { steps, findings, results } = applyDecisions(decideMatch[1], body.decisions, "button");
    return json({ asis_steps: steps, asis_findings: findings, results });
  }

  // ম্যাট্রিক্স-৩: citizen feedback responses (rows of 14 scores 1–5) → averages + classification
  const feedbackMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/sps\/feedback$/);
  if (method === "POST" && feedbackMatch) {
    const body = await req.json() as { rows?: number[][]; comments?: string[] };
    const summary = summariseFeedback(body.rows ?? [], body.comments ?? [], SPS_FEEDBACK.map((q) => q.key));
    if (!summary.respondents) return json({ error: "no_valid_rows" }, 400);
    const { class: _cls, ...feedback } = summary;
    updateSps(feedbackMatch[1], { feedback });
    return json(parseProject(db.query("SELECT * FROM projects WHERE id = ?").get(feedbackMatch[1]) as Row));
  }

  // Outputs: approved TO-BE versions (with the AS-IS each was built from)
  const versionsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/versions$/);
  if (method === "GET" && versionsMatch) {
    const pid = versionsMatch[1];
    syncActive(pid);   // projects approved before versions existed get their work saved as a version
    const list = listVersions(pid);
    // versions from before the Digitalization Analysis (or whose TO-BE changed) get theirs drafted
    for (const v of list) if (v.tobe_steps.length) ensureDigitalPlan(pid, v.id);
    return json(list);
  }

  // "Suggest a goal": one short AI call for a project that has none (older projects)
  const goalMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/suggest-goal$/);
  if (method === "POST" && goalMatch) {
    const p = db.query("SELECT name, description, country FROM projects WHERE id = ?").get(goalMatch[1]) as { name: string; description: string; country: string | null } | null;
    if (!p) return json({ error: "not_found" }, 404);
    try {
      const goal = await suggestGoal(p.name, p.description, p.country || "Bangladesh");
      if (!goal) return json({ error: "no_goal" }, 502);
      db.query("UPDATE projects SET goal = ?, goal_by = 'assistant', updated_at = unixepoch() WHERE id = ?").run(goal, goalMatch[1]);
      return json(parseProject(db.query("SELECT * FROM projects WHERE id = ?").get(goalMatch[1]) as Row));
    } catch (err) {
      return json({ error: String(err) }, 502);
    }
  }

  // Digitalization Analysis of an approved version's TO-BE: drafted (or redrafted) on request
  const digitalMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/versions\/(\d+)\/digital-plan$/);
  if (method === "POST" && digitalMatch) {
    try {
      const plan = await draftDigitalPlan(digitalMatch[1], Number(digitalMatch[2]));
      return plan ? json(plan) : json({ error: "no_plan" }, 502);
    } catch (err) {
      return json({ error: String(err) }, 502);
    }
  }

  // The version switcher: every version (drafts too) and the one that is open
  const allVersionsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/versions\/all$/);
  if (method === "GET" && allVersionsMatch) return json(versionList(allVersionsMatch[1]));

  // Open another version (not while the AI is working on this project)
  const openMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/versions\/(\d+)\/open$/);
  if (method === "POST" && openMatch) {
    if (runningJob(openMatch[1])) return json({ error: "running" }, 409);
    if (!openVersion(openMatch[1], Number(openMatch[2]))) return json({ error: "not_found" }, 404);
    return json(versionList(openMatch[1]));
  }

  // A new version from the open one, to change its approved AS-IS ("asis") or TO-BE ("tobe")
  const newMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/versions\/new$/);
  if (method === "POST" && newMatch) {
    if (runningJob(newMatch[1])) return json({ error: "running" }, 409);
    const body = await req.json().catch(() => ({})) as { kind?: string };
    const made = newVersion(newMatch[1], body.kind === "tobe" ? "tobe" : "asis");
    if (!made) return json({ error: "no_version" }, 400);
    return json({ ...made, ...versionList(newMatch[1]) });
  }
  // The current AS-IS or TO-BE as Excel ("Excel" on the AS-IS / TO-BE pages)
  const currentExport = url.pathname.match(/^\/api\/projects\/([^/]+)\/export$/);
  if (method === "GET" && currentExport) {
    const v = currentAsVersion(currentExport[1]);
    if (!v) return json({ error: "not_found" }, 404);
    const kind = url.searchParams.get("kind") === "tobe" ? "tobe" : "asis";
    try {
      const bytes = await exportExcel(kind, v, url.origin, true);
      const name = `${v.project_name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")}-${kind === "asis" ? "AS-IS" : "TO-BE"}.xlsx`;
      return new Response(bytes as unknown as BodyInit, {
        headers: cors(new Headers({
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        })),
      });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  }
  const exportMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/versions\/(\d+)\/export$/);
  if (method === "GET" && exportMatch) {
    const v = getVersion(exportMatch[1], Number(exportMatch[2]));
    if (!v) return json({ error: "not_found" }, 404);
    const k = url.searchParams.get("kind"); const kind = k === "asis" || k === "report" ? k : "tobe";
    try {
      // the plan and team are usually written after approval: use the project's current ones
      if (kind === "report") {
        const now = getSps(exportMatch[1]);
        v.sps = { ...v.sps, plan: now.plan ?? v.sps.plan, team: now.team ?? v.sps.team, office: now.office ?? v.sps.office, priority: now.priority ?? v.sps.priority, feedback: now.feedback ?? v.sps.feedback };
      }
      const bytes = await exportExcel(kind, v, url.origin);
      const name = `${v.project_name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")}-${kind === "asis" ? "AS-IS" : kind === "report" ? "SPS-report" : "TO-BE"}-v${v.version}.xlsx`;
      return new Response(bytes as unknown as BodyInit, {
        headers: cors(new Headers({
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        })),
      });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch) {
    const id = projectMatch[1];
    const row = db.query("SELECT * FROM projects WHERE id = ?").get(id) as Row | null;

    if (method === "GET") {
      if (!row) return json({ error: "not_found" }, 404);
      // running: the AI run in progress ("asis" | "tobe"), so the pages stay locked until it ends
      // version: the open version's number and what is approved (locked) in it
      if (!row.active_version) ensureActive(id);
      return json({ ...parseProject(row), running: runningJob(id), version: activeInfo(id) });
    }

    if (method === "PATCH") {
      if (!row) return json({ error: "not_found" }, 404);
      const body = await req.json() as Record<string, unknown>;
      const fields: string[] = [];
      const vals: unknown[] = [];
      // An approved AS-IS / TO-BE can't change: a change to it makes a new version first
      const lock = activeInfo(id);
      if (lock?.asis_locked && "asis_steps" in body) return json({ error: "locked", what: "asis", version: lock.version }, 409);
      if (lock?.tobe_locked && "tobe_steps" in body) return json({ error: "locked", what: "tobe", version: lock.version }, 409);
      // Approving the AS-IS needs every web/AI finding decided (missing values only warn)
      if (body.status === "asis_approved") {
        const { steps, findings } = loadAsis(id);
        const pending = coverage(steps, findings).pending;
        if (pending > 0) return json({ error: "pending_findings", pending }, 409);
      }
      // Approving the TO-BE needs every SPS check that fails to be fixed (warnings only warn)
      if (body.status === "tobe_approved") {
        const p = parseProject(row);
        const failed = checksBlocking(runChecks(p.asis_steps, p.tobe_steps, p.sps));
        if (failed.length) return json({ error: "sps_checks", failed: failed.map((c) => `${c.label}: ${c.detail}`) }, 409);
      }
      // SPS worksheets and settings (merged section by section)
      if (body.sps && typeof body.sps === "object") updateSps(id, body.sps as Partial<SpsData>);
      const allowed = ["name", "description", "goal", "status", "asis_steps", "tobe_steps", "interview_data", "country", "ministry", "department"];
      // the user editing the goal makes it theirs
      if (typeof body.goal === "string") { fields.push("goal_by = ?"); vals.push("user"); }
      for (const key of allowed) {
        if (key in body) {
          fields.push(`${key} = ?`);
          vals.push(typeof body[key] === "object" ? JSON.stringify(body[key]) : body[key]);
        }
      }
      // the user editing the project memory
      if (typeof body.memory === "string") setMemory(id, body.memory, "user");
      if (fields.length) {
        fields.push("updated_at = unixepoch()");
        vals.push(id);
        db.query(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
      }
      // approvals become versions in Outputs: the AS-IS on its own, then the TO-BE added to it
      // approvals are saved in the open version (shown in Outputs from then on)
      if (body.status || "tobe_steps" in body || "asis_steps" in body) syncActive(id);
      // an approved TO-BE edited since it was generated: its Digitalization Analysis is redrafted
      if (body.status === "tobe_approved") { const v = activeInfo(id); if (v) ensureDigitalPlan(id, v.id); }
      // steps replaced (undo, edits): pending findings of steps that are gone are closed
      if (Array.isArray(body.asis_steps)) {
        const { findings } = loadAsis(id);
        saveAsis(id, { findings: syncFindings(body.asis_steps as Step[], findings) });
      }
      return json(parseProject(db.query("SELECT * FROM projects WHERE id = ?").get(id) as Row));
    }

    if (method === "DELETE") {
      db.query("UPDATE projects SET trashed = 1 WHERE id = ?").run(id);
      return json({ ok: true });
    }
  }

  return json({ error: "not_found" }, 404);
}
