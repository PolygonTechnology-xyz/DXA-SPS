import { join } from "path";
import { existsSync, mkdirSync, readFileSync } from "fs";

// sps-api/.env wins over the shell: Bun only fills variables the shell has not set,
// so an old key exported in ~/.bashrc would otherwise be used instead of this project's key.
function fromDotEnv(name: string): string | undefined {
  try {
    const line = readFileSync(join(import.meta.dir, "..", ".env"), "utf8").split("\n")
      .find((l) => new RegExp(`^\\s*(export\\s+)?${name}\\s*=`).test(l));
    const value = line?.replace(/^[^=]*=\s*/, "").trim().replace(/^(['"])(.*)\1$/, "$2");
    return value || undefined;
  } catch {
    return undefined;
  }
}

export const PORT = parseInt(process.env.PORT ?? "8787");
export const ANTHROPIC_API_KEY = fromDotEnv("ANTHROPIC_API_KEY") ?? process.env.ANTHROPIC_API_KEY ?? "";
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
// The TO-BE (design + implementation plan), thinking adaptively — the main model for now;
// set TOBE_MODEL=claude-opus-5-5 in .env to design with Opus
export const TOBE_MODEL = process.env.TOBE_MODEL ?? ANTHROPIC_MODEL;
export const ANTHROPIC_MODEL_FAST = process.env.ANTHROPIC_MODEL_FAST ?? "claude-haiku-4-5-20251001";
export const ANTHROPIC_WORKSPACE_ID = process.env.ANTHROPIC_WORKSPACE_ID;

// Models the user can pick in the home chat (the first one matching ANTHROPIC_MODEL is the default)
export const CHAT_MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", note: "Fast, the current default" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", note: "Fast and low cost" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", note: "Balanced" },
  { id: "claude-opus-5-5", label: "Opus 5.5", note: "Most capable" },
];
export const ELEVENLABS_API_KEY = fromDotEnv("ELEVENLABS_API_KEY") ?? process.env.ELEVENLABS_API_KEY ?? "";
export const ELEVENLABS_STT_MODEL = process.env.ELEVENLABS_STT_MODEL ?? "scribe_v1";
export const DATA_DIR = join(import.meta.dir, "..", "..", "workspace", "sps-data");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
