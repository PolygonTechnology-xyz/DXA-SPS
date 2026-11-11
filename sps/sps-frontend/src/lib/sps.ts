import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'

// The guideline's fixed lists, served by the backend (sps-api/src/services/sps-guide.ts)
export interface SpsMeta {
  aspects: Array<{ key: string; en: string; bn: string }>
  profile: Array<{ key: string; en: string; bn: string; options: string[] }>
  priority: Array<{ key: string; en: string; bn: string; scale: Array<[number, string]> }>
  feedback: Array<{ key: string; en: string; bn: string }>
}

export function useSpsMeta() {
  return useQuery({
    queryKey: ['sps-meta'],
    queryFn: () => api.get<SpsMeta>('/api/sps/meta'),
    staleTime: Infinity,
  })
}

export const taka = (n: number | null | undefined) => (n == null ? '—' : `৳${Math.round(n).toLocaleString('en-IN')}`)

export const STEP_TYPE_LABEL: Record<string, { icon: string; label: string }> = {
  activity: { icon: '▭', label: 'Activity' },
  decision: { icon: '◇', label: 'Decision' },
  document: { icon: '🗎', label: 'Document' },
  message: { icon: '✉', label: 'Message' },
}

/** ম্যাট্রিক্স-৩ classification of a total score (14–70) */
export function feedbackClass(total: number) {
  if (total >= 56) return { label: 'Citizen-friendly · নাগরিকবান্ধব', color: '#15803d' }
  if (total >= 36) return { label: 'SPS needed · এসপিএস প্রয়োজন', color: '#b45309' }
  return { label: 'Urgent — start SPS now · অবিলম্বে এসপিএস প্রয়োজন', color: 'var(--danger)' }
}
