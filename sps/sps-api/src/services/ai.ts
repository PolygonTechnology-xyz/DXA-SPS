import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, ANTHROPIC_WORKSPACE_ID, ANTHROPIC_MODEL } from "../config";

export const client = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
  ...(ANTHROPIC_WORKSPACE_ID ? { defaultHeaders: { "anthropic-workspace-id": ANTHROPIC_WORKSPACE_ID } } : {}),
});

// Re-export model constants for convenience in route files
export { ANTHROPIC_MODEL };
