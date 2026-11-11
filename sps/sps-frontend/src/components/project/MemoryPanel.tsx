import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Brain, Pencil, X } from 'lucide-react'
import { projectsApi } from '@/api/projects'
import { Button } from '@/components/ui'

/**
 * The project memory: short notes (decisions, facts, preferences, open questions) that
 * every AI step reads. The assistant keeps it current; the user can read and edit it.
 */
export default function MemoryPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: !!projectId,
  })
  const memory = project?.memory ?? ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(memory)

  useEffect(() => { if (!editing) setDraft(memory) }, [memory, editing])

  const save = useMutation({
    mutationFn: (text: string) => projectsApi.update(projectId, { memory: text }),
    onSuccess: () => {
      setEditing(false)
      qc.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })

  const updated = project?.memory_updated_at
    ? `Updated by ${project.memory_updated_by === 'user' ? 'you' : 'the assistant'} · ${new Date(project.memory_updated_at * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : ''

  return (
    <div style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg)', padding: '12px 16px', flexShrink: 0, maxHeight: '45%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Brain size={15} style={{ color: 'var(--accent)' }} />
        <strong style={{ fontSize: 13, flex: 1 }}>Project memory</strong>
        {!editing && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}
        <Button size="sm" variant="ghost" icon={X} onClick={onClose} aria-label="Close memory" />
      </div>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--muted)' }}>
        Decisions, facts and preferences the AI follows in every step (AS-IS, interview, TO-BE, chat).{updated && <> {updated}.</>}
      </p>

      {editing ? (
        <>
          <textarea
            className="ui-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={'## Decisions\n- …\n\n## Facts\n- …'}
            style={{ minHeight: 160, flex: 1, fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: 12.5, padding: 10, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate(draft)}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(memory) }}>Cancel</Button>
          </div>
        </>
      ) : memory ? (
        <pre style={{ margin: 0, overflowY: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink)' }}>{memory}</pre>
      ) : (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>
          Nothing yet. Tell the assistant what you decide or confirm (e.g. “the fee is paid online”) and it will note it here.
        </p>
      )}
    </div>
  )
}
