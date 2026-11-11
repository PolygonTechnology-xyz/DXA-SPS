import type Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/index";
import { client } from "./ai";
import { ANTHROPIC_MODEL_FAST } from "../config";
import { log } from "../utils/log";

// ── Project memory ────────────────────────────────────────────────────────────
//
// Modelled on dxa-work's MEMORY.md: a short, curated set of notes per project —
// decisions, confirmed facts, preferences, open questions. Every AI step (chat,
// AS-IS, interview, TO-BE) reads it; the chat agent keeps it current with the
// update_memory tool, and the user can edit it. It has a size limit, so notes are
// merged and pruned rather than appended forever.

export const MEMORY_SECTIONS = ["Decisions", "Facts", "Preferences", "Open questions"] as const;
const MEMORY_MAX_CHARS = 3000;

export function getMemory(projectId: string): string {
  const row = db.query("SELECT memory FROM projects WHERE id = ?").get(projectId) as { memory: string | null } | null;
  return row?.memory?.trim() ?? "";
}

/** Memory as a prompt section ("" when empty) */
export function memoryBlock(projectId: string | undefined): string {
  if (!projectId) return "";
  const memory = getMemory(projectId);
  return memory
    ? `\n\nPROJECT MEMORY (decisions, confirmed facts and preferences recorded for this project — follow them; they override your own assumptions):\n${memory}`
    : "";
}

export function setMemory(projectId: string, text: string, by: "user" | "assistant"): void {
  db.query("UPDATE projects SET memory = ?, memory_updated_at = unixepoch(), memory_updated_by = ? WHERE id = ?")
    .run(text.trim(), by, projectId);
}

/** Adds a bullet under a "## Section" heading, creating the heading in the standard order */
function addNote(memory: string, section: string, note: string): string {
  const lines = memory ? memory.split("\n") : [];
  const heading = `## ${section}`;
  let at = lines.findIndex((l) => l.trim().toLowerCase() === heading.toLowerCase());
  if (at === -1) {
    // insert before the first heading that comes later in the standard order
    const order = MEMORY_SECTIONS as readonly string[];
    const mine = order.indexOf(section);
    let insertAt = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^##\s+(.+)$/);
      if (m && order.indexOf(m[1].trim()) > mine) { insertAt = i; break; }
    }
    const block = [heading, `- ${note}`, ""];
    if (insertAt > 0 && lines[insertAt - 1]?.trim()) block.unshift("");
    lines.splice(insertAt, 0, ...block);
    return lines.join("\n").trim();
  }
  // after the last bullet of that section
  let end = at + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end++;
  while (end > at + 1 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, `- ${note}`);
  return lines.join("\n").trim();
}

export const memoryToolDefinitions: Anthropic.Tool[] = [{
  name: "update_memory",
  description: `Keep the PROJECT MEMORY current: short notes that every later step (AS-IS, interview, TO-BE, future chats) will follow.
Record what the user decides, confirms or prefers, and open questions — not things already in the steps or documents, and not chit-chat.
- add: a new note (one line, at most ~25 words) under a section: ${MEMORY_SECTIONS.join(", ")}
- replace: rewrite an existing note (old = its exact text) — use this when something changes or to merge notes
- remove: delete a note that is wrong, done or no longer relevant
Memory is limited to ${MEMORY_MAX_CHARS} characters: merge and prune rather than append.`,
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["add", "replace", "remove"] },
      section: { type: "string", enum: [...MEMORY_SECTIONS], description: "For add" },
      note: { type: "string", description: "For add: the note. For replace: the new text." },
      old: { type: "string", description: "For replace / remove: the exact existing text" },
    },
    required: ["action"],
  },
}];

export function executeMemoryTool(projectId: string, input: Record<string, unknown>): { summary: string; changed: boolean } {
  const memory = getMemory(projectId);
  const action = String(input.action ?? "");
  const note = String(input.note ?? "").replace(/\s+/g, " ").trim().replace(/^-\s*/, "");
  const old = String(input.old ?? "").trim().replace(/^-\s*/, "");
  let next = memory;

  if (action === "add") {
    const section = (MEMORY_SECTIONS as readonly string[]).find((s) => s.toLowerCase() === String(input.section ?? "").toLowerCase()) ?? "Facts";
    if (!note) return { summary: "Nothing to add: note is empty.", changed: false };
    if (memory.toLowerCase().includes(note.toLowerCase())) return { summary: "Already in memory.", changed: false };
    next = addNote(memory, section, note);
  } else if (action === "replace" || action === "remove") {
    if (!old || !memory.includes(old)) return { summary: `Not found in memory: "${old}". Use the exact text as it appears.`, changed: false };
    if (action === "replace" && !note) return { summary: "replace needs the new text in note.", changed: false };
    if (action === "replace") next = memory.replace(old, note);
    else {
      // drop the whole note when old is the full note, else just that text
      const lines = memory.split("\n");
      const at = lines.findIndex((l) => l.trim().replace(/^-\s*/, "") === old);
      next = at >= 0 ? [...lines.slice(0, at), ...lines.slice(at + 1)].join("\n") : memory.replace(old, "");
    }
    // drop headings left without notes
    const lines = next.split("\n");
    next = lines.filter((l, i) => {
      if (!l.startsWith("## ")) return true;
      const following = lines.slice(i + 1).find((x) => x.trim());
      return !!following && !following.startsWith("## ");
    }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  } else {
    return { summary: `Unknown action "${action}". Use add, replace or remove.`, changed: false };
  }

  if (next.length > MEMORY_MAX_CHARS) {
    return { summary: `Memory is full (${next.length}/${MEMORY_MAX_CHARS} characters). Merge or remove older notes first, then retry.`, changed: false };
  }
  setMemory(projectId, next, "assistant");
  log.tool(`update_memory  ${action}  chars=${next.length}`);
  return { summary: `Memory updated (${action}).`, changed: true };
}

// ── Conversation history with a rolling summary ───────────────────────────────
//
// The chat rail keeps every message (chat_messages). The model sees a summary of the
// older part plus the recent messages; after a reply, once enough unsummarised
// messages pile up, the older ones are folded into the summary in the background.

const KEEP_RECENT = 12;        // messages always sent verbatim
const COMPACT_AFTER = 24;      // unsummarised messages before compaction runs

export interface ChatContext {
  summary: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export function loadChatContext(projectId: string): ChatContext {
  const row = db.query("SELECT chat_summary, chat_summary_upto FROM projects WHERE id = ?").get(projectId) as { chat_summary: string | null; chat_summary_upto: number | null } | null;
  const upto = row?.chat_summary_upto ?? 0;
  const rows = db.query(
    "SELECT role, content FROM chat_messages WHERE project_id = ? AND mode = 'chat' AND id > ? ORDER BY id"
  ).all(projectId, upto) as Array<{ role: "user" | "assistant"; content: string }>;
  // if compaction is behind, never send more than COMPACT_AFTER messages
  const messages = rows.slice(-COMPACT_AFTER);
  // the API needs the conversation to start with a user turn
  while (messages.length && messages[0].role !== "user") messages.shift();
  return { summary: row?.chat_summary?.trim() ?? "", messages };
}

export function resetChatSummary(projectId: string): void {
  db.query("UPDATE projects SET chat_summary = '', chat_summary_upto = 0 WHERE id = ?").run(projectId);
}

const compacting = new Set<string>();

/** Folds older chat messages into the project's summary. Safe to call after every reply. */
export async function compactChat(projectId: string): Promise<void> {
  if (compacting.has(projectId)) return;
  const row = db.query("SELECT chat_summary, chat_summary_upto FROM projects WHERE id = ?").get(projectId) as { chat_summary: string | null; chat_summary_upto: number | null } | null;
  const upto = row?.chat_summary_upto ?? 0;
  const rows = db.query(
    "SELECT id, role, content FROM chat_messages WHERE project_id = ? AND mode = 'chat' AND id > ? ORDER BY id"
  ).all(projectId, upto) as Array<{ id: number; role: string; content: string }>;
  if (rows.length <= COMPACT_AFTER) return;

  const older = rows.slice(0, rows.length - KEEP_RECENT);
  compacting.add(projectId);
  try {
    const transcript = older.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL_FAST,
      max_tokens: 800,
      system: `You maintain a running summary of a chat between a government officer and an AI analyst working on one SPS (Service Process Simplification) project. Merge the earlier summary with the new messages into one updated summary of at most 250 words: what was asked, what was changed (steps added, edited, removed), what was decided or agreed, and what is still open. Keep names, numbers and step numbers exact. Plain text, no preamble.`,
      messages: [{
        role: "user",
        content: `Earlier summary:\n${row?.chat_summary?.trim() || "(none)"}\n\nNew messages:\n${transcript}`,
      }],
    });
    const summary = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
    if (summary) {
      db.query("UPDATE projects SET chat_summary = ?, chat_summary_upto = ? WHERE id = ?").run(summary, older[older.length - 1].id, projectId);
      log.chat(`compacted  project=${projectId}  folded=${older.length}  summary=${summary.length} chars`);
    }
  } catch (err) {
    log.error(`compactChat: ${String(err)}`);
  } finally {
    compacting.delete(projectId);
  }
}
