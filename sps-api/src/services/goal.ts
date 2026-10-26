import { client } from "./ai";
import { ANTHROPIC_MODEL_FAST } from "../config";
import { log } from "../utils/log";

/** The rule both the home agent and "Suggest a goal" follow */
export const GOAL_RULE =
  "goal = one sentence (max 20 words) saying what the simplified service should achieve for citizens — " +
  "e.g. fewer visits, fewer days, online, fewer documents. Concrete but not invented numbers unless the user gave them. " +
  "Same language as the user.";

/** One short AI call: a goal for a project that has none */
export async function suggestGoal(name: string, description: string, country: string): Promise<string> {
  const res = await client.messages.create({
    model: ANTHROPIC_MODEL_FAST,
    max_tokens: 120,
    system: `You write the goal of an SPS (Service Process Simplification) project for a ${country} government service. ${GOAL_RULE} Reply with the sentence only.`,
    messages: [{ role: "user", content: `Service: ${name}${description ? `\nDescription: ${description}` : ""}` }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  log.analyze(`suggest-goal  "${name}" → ${text.slice(0, 80)}`);
  return text.replace(/^["“]|["”]$/g, "").trim();
}
