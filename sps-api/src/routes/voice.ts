import { json } from "../utils/cors";
import { log } from "../utils/log";
import { ELEVENLABS_API_KEY, ELEVENLABS_STT_MODEL } from "../config";

// Voice commands: the browser records the user, this turns the audio into text with
// ElevenLabs Speech-to-Text. The key stays on the server.

const MAX_BYTES = 25 * 1024 * 1024;

export async function handleVoice(req: Request, url: URL): Promise<Response> {
  if (url.pathname !== "/api/voice/transcribe" || req.method.toUpperCase() !== "POST") return json({ error: "not_found" }, 404);
  if (!ELEVENLABS_API_KEY) return json({ error: "Voice is not set up — add ELEVENLABS_API_KEY to sps-api/.env." }, 503);

  let audio: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("audio");
    if (f instanceof File) audio = f;
  } catch { /* handled below */ }
  if (!audio || audio.size === 0) return json({ error: "No audio received." }, 400);
  if (audio.size > MAX_BYTES) return json({ error: "The recording is too long." }, 413);

  const body = new FormData();
  body.append("file", audio, audio.name || "voice.webm");
  body.append("model_id", ELEVENLABS_STT_MODEL);
  body.append("tag_audio_events", "false");

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      log.error(`voice: ElevenLabs answered ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
      return json({ error: "The voice could not be transcribed." }, 502);
    }
    const data = (await res.json()) as { text?: string; language_code?: string };
    return json({ text: (data.text ?? "").trim(), language: data.language_code ?? null });
  } catch (err) {
    log.error(`voice: ${String(err)}`);
    return json({ error: "The voice service could not be reached." }, 502);
  }
}
