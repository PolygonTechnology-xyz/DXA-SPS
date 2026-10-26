import { Database } from "bun:sqlite";
import { join } from "path";
import { DATA_DIR } from "../config";
import { compareTcvq, runChecks, type SpsData } from "../services/sps-calc";

export const db = new Database(join(DATA_DIR, "projects.db"), { create: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    asis_steps TEXT DEFAULT '[]',
    tobe_steps TEXT DEFAULT '[]',
    interview_data TEXT DEFAULT '{}',
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    trashed INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER DEFAULT 0,
    path TEXT,
    url TEXT,
    content TEXT DEFAULT '',
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );
`);

// Safe migration for existing databases
try { db.exec("ALTER TABLE files ADD COLUMN content TEXT DEFAULT ''"); } catch { /* already exists */ }
try { db.exec("ALTER TABLE projects ADD COLUMN asis_gaps TEXT DEFAULT '[]'"); } catch { /* already exists */ }
// Fingerprint of the project's documents when AS-IS was generated (to flag stale results)
try { db.exec("ALTER TABLE projects ADD COLUMN asis_docs_sig TEXT"); } catch { /* already exists */ }

// Project memory and chat summary (see services/memory.ts)
for (const col of [
  "memory TEXT DEFAULT ''",
  "memory_updated_at INTEGER",
  "memory_updated_by TEXT",          // user | assistant
  "chat_summary TEXT DEFAULT ''",    // older chat messages, condensed
  "chat_summary_upto INTEGER DEFAULT 0",
  // AS-IS review (see services/review.ts and services/asis-state.ts)
  "country TEXT DEFAULT 'Bangladesh'",
  "asis_findings TEXT DEFAULT '[]'",   // web/AI proposals awaiting the user's consent
  "asis_review TEXT",                  // last review: when, questions
  "sps TEXT DEFAULT '{}'",             // SPS worksheets and settings (services/sps-calc.ts)
  // what the simplification should achieve; written by the assistant, then the user's to change
  "goal TEXT DEFAULT ''",
  "goal_by TEXT",                      // assistant | user
]) {
  try { db.exec(`ALTER TABLE projects ADD COLUMN ${col}`); } catch { /* already exists */ }
}

// Document ingestion: each file is split into pages (see services/ingest.ts)
for (const col of [
  "kind TEXT",            // pdf | text | image
  "pdf_path TEXT",        // the PDF the agent reads (the original, or an office file converted)
  "pages INTEGER DEFAULT 0",
  "status TEXT",          // processing | ready | visual | failed | unsupported
  "status_note TEXT",
  "sha256 TEXT",
]) {
  try { db.exec(`ALTER TABLE files ADD COLUMN ${col}`); } catch { /* already exists */ }
}

// Bangla vowel signs and other combining marks are not letters to SQLite, so the default
// tokenizer would split Bangla words apart — declare them as word characters.
const BANGLA_MARKS = [0x981, 0x982, 0x983, 0x9bc, ...Array.from({ length: 0x9cd - 0x9be + 1 }, (_, i) => 0x9be + i), 0x9d7, 0x9e2, 0x9e3]
  .map((c) => String.fromCodePoint(c)).join("");

db.exec(`
  CREATE TABLE IF NOT EXISTS file_pages (
    file_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    text TEXT DEFAULT '',
    quality TEXT DEFAULT 'good',   -- good | empty | garbled
    PRIMARY KEY (file_id, page)
  );
  -- Chat rail conversation, kept per project
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    role TEXT NOT NULL,               -- user | assistant
    content TEXT NOT NULL,
    mode TEXT DEFAULT 'chat',         -- chat | interview
    pane TEXT,                        -- tab the user was on
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS chat_messages_project ON chat_messages (project_id, id);
  -- Every consent decision on a web/AI finding (audit trail)
  CREATE TABLE IF NOT EXISTS consent_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    finding_id TEXT NOT NULL,
    decision TEXT NOT NULL,          -- accepted | rejected
    what TEXT,                       -- e.g. "Step 7 · Law / regulation"
    value TEXT,
    decided_via TEXT,                -- button | chat
    created_at INTEGER DEFAULT (unixepoch())
  );
  -- Every approved TO-BE, with the approved AS-IS it was designed from (the Outputs tab)
  CREATE TABLE IF NOT EXISTS tobe_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    project_name TEXT,
    country TEXT,
    asis_steps TEXT NOT NULL,
    tobe_steps TEXT NOT NULL,
    approved_at INTEGER DEFAULT (unixepoch())
  );
  -- Global Knowledge: laws, rules, circulars shared by every project (files use this project id)
  INSERT OR IGNORE INTO projects (id, name, description, trashed) VALUES ('__global__', 'Global Knowledge', 'Shared library', 1);
  CREATE VIRTUAL TABLE IF NOT EXISTS file_pages_fts USING fts5(
    text, file_id UNINDEXED, project_id UNINDEXED, page UNINDEXED,
    tokenize = "unicode61 remove_diacritics 0 tokenchars '${BANGLA_MARKS}'"
  );
`);

// Versions keep the SPS worksheets they were approved with
try { db.exec("ALTER TABLE tobe_versions ADD COLUMN sps TEXT DEFAULT '{}'"); } catch { /* already exists */ }

// Versions: every AS-IS (with its TO-BE) is a full record — drafts too, not only approved
// work — and the project works on one of them at a time (see services/versions.ts)
for (const col of [
  "status TEXT",                       // the project status of that version (draft … tobe_approved)
  "asis_findings TEXT DEFAULT '[]'",
  "asis_review TEXT",
  "asis_gaps TEXT DEFAULT '[]'",
  "asis_docs_sig TEXT",
  "interview_data TEXT DEFAULT '{}'",
  "updated_at INTEGER",
]) {
  try { db.exec(`ALTER TABLE tobe_versions ADD COLUMN ${col}`); } catch { /* already exists */ }
}
// rows saved before: always approved (they were only made on approval)
db.exec("UPDATE tobe_versions SET status = CASE WHEN tobe_steps NOT IN ('[]', '') THEN 'tobe_approved' ELSE 'asis_approved' END WHERE status IS NULL");
try { db.exec("ALTER TABLE projects ADD COLUMN active_version INTEGER"); } catch { /* already exists */ }

// Chat messages can be cards (e.g. a consent card), not only text
for (const col of ["kind TEXT DEFAULT 'text'", "payload TEXT"]) {
  try { db.exec(`ALTER TABLE chat_messages ADD COLUMN ${col}`); } catch { /* already exists */ }
}

// ── Types & helpers ──────────────────────────────────────────────────────────

export type Row = Record<string, unknown>;

export function parseProject(row: Row) {
  const asis = parseJsonField(row.asis_steps as string, []) as Array<Record<string, unknown>>;
  const tobe = parseJsonField(row.tobe_steps as string, []) as Array<Record<string, unknown>>;
  const sps = parseJsonField(row.sps as string, {}) as SpsData;
  return {
    ...row,
    sps,
    // computed from the steps and the SPS data — never stored
    tcvq: compareTcvq(asis, tobe, sps),
    sps_checks: runChecks(asis, tobe, sps),
    asis_steps: parseJsonField(row.asis_steps as string, []),
    tobe_steps: parseJsonField(row.tobe_steps as string, []),
    interview_data: parseJsonField(row.interview_data as string, {}),
    asis_gaps: parseJsonField(row.asis_gaps as string, []),
    asis_findings: parseJsonField(row.asis_findings as string, []),
    asis_review: parseJsonField(row.asis_review as string, null),
    // Documents changed (added, removed or replaced) since AS-IS was generated
    asis_docs_stale: !!row.asis_docs_sig && row.asis_docs_sig !== docsSignature(row.id as string),
  };
}

/** Fingerprint of a project's current documents (ids + content hashes) */
export function docsSignature(projectId: string): string {
  const rows = db.query("SELECT id, sha256 FROM files WHERE project_id = ? ORDER BY id").all(projectId) as { id: string; sha256: string | null }[];
  return new Bun.CryptoHasher("sha256").update(rows.map((r) => `${r.id}:${r.sha256 ?? ""}`).join("|")).digest("hex").slice(0, 16);
}

export function parseJsonField(val: string, fallback: unknown) {
  try { return JSON.parse(val); } catch { return fallback; }
}
