import { BASE } from './client'

export const voiceApi = {
  /** Speech-to-text through the API (ElevenLabs) */
  async transcribe(audio: Blob): Promise<string> {
    const ext = audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg' : 'webm'
    const form = new FormData()
    form.append('audio', audio, `voice.${ext}`)
    const res = await fetch(`${BASE}/api/voice/transcribe`, { method: 'POST', body: form })
    const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data.text ?? ''
  },
}
