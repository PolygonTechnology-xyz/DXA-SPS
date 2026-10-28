import { useState, useRef, useEffect, useCallback } from 'react'
import { voiceApi } from '@/api/voice'

export type VoiceState = 'idle' | 'recording' | 'transcribing'

const MAX_MS = 60_000

/** Records from the microphone; on stop the audio is transcribed (ElevenLabs) and handed to onText */
export function useVoiceRecorder(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  // the latest callback — the transcript arrives after later renders
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

  const stop = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (recRef.current?.state === 'recording') recRef.current.stop()
  }, [])

  const start = useCallback(async () => {
    if (!supported || recRef.current) return
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Microphone access was blocked. Allow it in the browser to use voice.')
      return
    }
    const rec = new MediaRecorder(stream)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      recRef.current = null
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
      if (!blob.size) { setState('idle'); return }
      setState('transcribing')
      try {
        const text = await voiceApi.transcribe(blob)
        if (text) onTextRef.current(text)
        else setError("I didn't catch that — please try again.")
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The voice could not be transcribed.')
      } finally {
        setState('idle')
      }
    }
    recRef.current = rec
    rec.start()
    setState('recording')
    timerRef.current = window.setTimeout(stop, MAX_MS)
  }, [supported, stop])

  const toggle = useCallback(() => {
    if (state === 'recording') stop()
    else if (state === 'idle') start()
  }, [state, start, stop])

  // release the microphone when the page closes mid-recording
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const rec = recRef.current
    if (rec) { rec.onstop = null; rec.stream.getTracks().forEach((t) => t.stop()); if (rec.state === 'recording') rec.stop() }
  }, [])

  return { state, error, supported, toggle, clearError: () => setError(null) }
}
