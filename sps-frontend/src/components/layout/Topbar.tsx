import { useParams, useMatch } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { projectsApi } from '@/api/projects'
import { useNavigation } from '@/stores/navigation'
import { Menu, ChevronRight } from 'lucide-react'
import { IconButton } from '@/components/ui'

export default function Topbar() {
  const { toggleSidebar } = useNavigation()
  const { id, pane } = useParams<{ id?: string; pane?: string }>()
  // inside a project the title reads "Project name / Section"
  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id && pane !== 'knowledge',
  })

  let title = 'SPS'
  const onKnowledge = !!useMatch('/knowledge')
  if (onKnowledge) {
    title = 'Global Knowledge'
  } else if (!id) {
    title = 'All Projects'
  } else {
    const paneTitles: Record<string, string> = {
      overview: 'Project Overview',
      asis: 'AS-IS Process',
      tobe: 'TO-BE Process',
      files: 'Files & Records',
      outputs: 'Outputs',
      knowledge: 'Global Knowledge',
    }
    title = paneTitles[pane ?? 'overview'] ?? 'Project'
  }

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 18px', minHeight: 56,
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
        flexShrink: 0,
      }}
    >
      <IconButton icon={Menu} label="Toggle sidebar" onClick={toggleSidebar} />
      <h2 style={{ fontSize: 15, margin: 0, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {id && project?.name && pane !== 'knowledge' && (
          <>
            <span title={project.name} style={{ color: 'var(--muted)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '40vw' }}>{project.name}</span>
            <ChevronRight size={15} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          </>
        )}
        <span style={{ whiteSpace: 'nowrap' }}>{title}</span>
      </h2>
      <div style={{ flex: 1 }} />
    </header>
  )
}
