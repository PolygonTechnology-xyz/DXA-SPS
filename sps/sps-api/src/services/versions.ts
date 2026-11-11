import { db } from "../db/index";
import { log } from "../utils/log";

// Versions of a project's process. Every AS-IS (with the TO-BE designed from it) is a row of
// tobe_versions — the draft one too. The project's own columns are the working area: they
// always hold the version the user has open (projects.active_version), so the AI, chat and
// review code keep working on the project as before. Switching saves the working area into
// its row and loads the other one.
//
// Rules: an approved AS-IS can't change, and neither can an approved TO-BE; changing one
// makes a new version. Only the latest version can have an AS-IS that is not approved yet.

/** Project columns that belong to a version */
const COLS = ["asis_steps", "asis_findings", "asis_review", "asis_gaps", "asis_docs_sig", "tobe_steps", "interview_data", "sps", "status"] as const;

const ASIS_LOCKED = new Set(["asis_approved", "tobe_complete", "tobe_approved"]);

export const isAsisLocked = (status: unknown) => ASIS_LOCKED.has(String(status ?? ""));
export const isTobeLocked = (status: unknown) => String(status ?? "") === "tobe_approved";

type Work = Record<(typeof COLS)[number], string | null> & { name: string; country: string | null; active_version: number | null };
type VersionRow = Record<(typeof COLS)[number], string | null> & { id: number; version: number; approved_at: number | null; updated_at: number | null };

const work = (projectId: string) =>
  db.query(`SELECT name, country, active_version, ${COLS.join(", ")} FROM projects WHERE id = ?`).get(projectId) as Work | null;
const row = (projectId: string, id: number) =>
  db.query("SELECT * FROM tobe_versions WHERE project_id = ? AND id = ?").get(projectId, id) as VersionRow | null;
const latest = (projectId: string) =>
  db.query("SELECT * FROM tobe_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1").get(projectId) as VersionRow | null;
const hasSteps = (json: string | null) => { try { return (JSON.parse(json || "[]") as unknown[]).length > 0; } catch { return false; } };

function insert(projectId: string, w: Work, version: number): number {
  const res = db.query(`INSERT INTO tobe_versions (project_id, version, project_name, country, ${COLS.join(", ")}, approved_at, updated_at)
    VALUES (?, ?, ?, ?, ${COLS.map(() => "?").join(", ")}, NULL, unixepoch())`)
    .run(projectId, version, w.name, w.country || "Bangladesh", ...COLS.map((c) => w[c] ?? null));
  return Number(res.lastInsertRowid);
}

/**
 * The version the working area belongs to; made the first time it is needed (projects from
 * before versions, or the first AS-IS of a project). Null while the project has no AS-IS.
 */
export function ensureActive(projectId: string): number | null {
  const w = work(projectId);
  if (!w) return null;
  if (w.active_version && row(projectId, w.active_version)) return w.active_version;
  if (!hasSteps(w.asis_steps)) return null;
  const last = latest(projectId);
  // the working area is the latest saved version, unless it changed after that was approved
  const same = last && last.asis_steps === w.asis_steps && (last.tobe_steps === w.tobe_steps || !isTobeLocked(last.status));
  const id = same ? last!.id : insert(projectId, w, (last?.version ?? 0) + 1);
  db.query("UPDATE projects SET active_version = ? WHERE id = ?").run(id, projectId);
  log.tool(`versions: ${projectId} works on version id=${id}${same ? "" : " (new)"}`);
  return id;
}

/** Save the working area into its version row (after generation, approval, before switching) */
export function syncActive(projectId: string): number | null {
  const id = ensureActive(projectId);
  if (!id) return null;
  const w = work(projectId)!;
  const before = row(projectId, id);
  // the moment it is approved (AS-IS, then TO-BE) is the version's date in Outputs
  const approvedNow = before && w.status !== before.status && (w.status === "asis_approved" || w.status === "tobe_approved");
  db.query(`UPDATE tobe_versions SET ${COLS.map((c) => `${c} = ?`).join(", ")}, project_name = ?, country = ?, updated_at = unixepoch()${approvedNow ? ", approved_at = unixepoch()" : ""} WHERE id = ?`)
    .run(...COLS.map((c) => w[c] ?? null), w.name, w.country || "Bangladesh", id);
  return id;
}

function load(projectId: string, r: VersionRow) {
  db.query(`UPDATE projects SET ${COLS.map((c) => `${c} = ?`).join(", ")}, active_version = ?, updated_at = unixepoch() WHERE id = ?`)
    .run(...COLS.map((c) => r[c] ?? null), r.id, projectId);
}

export interface VersionInfo {
  id: number
  version: number
  status: string
  asis_locked: boolean
  tobe_locked: boolean
  asis_count: number
  tobe_count: number
  approved_at: number | null
  updated_at: number | null
}

/** Every version (drafts too) for the switcher, newest first, and the one that is open */
export function versionList(projectId: string): { versions: VersionInfo[]; active: number | null } {
  const active = syncActive(projectId);
  const rows = db.query("SELECT * FROM tobe_versions WHERE project_id = ? ORDER BY version DESC").all(projectId) as VersionRow[];
  const count = (j: string | null) => { try { return (JSON.parse(j || "[]") as unknown[]).length; } catch { return 0; } };
  return {
    active,
    versions: rows.map((r) => ({
      id: r.id, version: r.version, status: r.status ?? "draft",
      asis_locked: isAsisLocked(r.status), tobe_locked: isTobeLocked(r.status),
      asis_count: count(r.asis_steps), tobe_count: count(r.tobe_steps),
      approved_at: r.approved_at, updated_at: r.updated_at,
    })),
  };
}

/** The open version's number and locks (for the project API and the guards) */
export function activeInfo(projectId: string): { id: number; version: number; asis_locked: boolean; tobe_locked: boolean } | null {
  const w = work(projectId);
  if (!w) return null;
  const r = w.active_version ? row(projectId, w.active_version) : null;
  // before the first sync the working area's own status decides
  return {
    id: r?.id ?? 0, version: r?.version ?? 0,
    asis_locked: isAsisLocked(w.status), tobe_locked: isTobeLocked(w.status),
  };
}

/** Open another version: the working area is saved first, then the other one is loaded */
export function openVersion(projectId: string, id: number): boolean {
  const target = row(projectId, id);
  if (!target) return false;
  syncActive(projectId);
  load(projectId, target);
  log.tool(`versions: ${projectId} opened v${target.version}`);
  return true;
}

/**
 * A new version from the open one, to change what is approved there:
 * - "asis": its AS-IS as a new draft (not approved), without a TO-BE — to edit or regenerate it
 * - "tobe": the same approved AS-IS with its TO-BE as a new draft — to edit or regenerate the TO-BE
 * An AS-IS draft that is not approved yet (always the latest version) is replaced, so there is
 * only ever one. Returns the new version's number.
 */
export function newVersion(projectId: string, kind: "asis" | "tobe"): { id: number; version: number; replaced: number | null } | null {
  const srcId = syncActive(projectId);
  if (!srcId) return null;
  const src = row(projectId, srcId)!;
  const last = latest(projectId)!;
  const w = work(projectId)!;
  const next: Work = {
    ...w,
    ...Object.fromEntries(COLS.map((c) => [c, src[c]])) as Pick<Work, (typeof COLS)[number]>,
    ...(kind === "asis"
      ? { status: "asis_complete", tobe_steps: "[]", interview_data: "{}" }
      : { status: "tobe_complete" }),
  };
  let id: number;
  let replaced: number | null = null;
  if (last.id !== src.id && !isAsisLocked(last.status)) {
    // the unapproved AS-IS draft is replaced (kept at its number)
    replaced = last.version;
    db.query(`UPDATE tobe_versions SET ${COLS.map((c) => `${c} = ?`).join(", ")}, approved_at = NULL, updated_at = unixepoch() WHERE id = ?`)
      .run(...COLS.map((c) => next[c] ?? null), last.id);
    id = last.id;
  } else {
    id = insert(projectId, next, last.version + 1);
  }
  load(projectId, row(projectId, id)!);
  const v = row(projectId, id)!.version;
  log.tool(`versions: ${projectId} new ${kind} version v${v} from v${src.version}${replaced ? ` (replaced draft v${replaced})` : ""}`);
  return { id, version: v, replaced };
}
