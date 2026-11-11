import { useParams, useMatch } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import AllProjects from '@/views/AllProjects'
import ProjectsList from '@/views/ProjectsList'
import GlobalKnowledge from '@/views/GlobalKnowledge'
import ProjectPage from '@/views/ProjectPage'
import ReferencePopup from '@/components/ui/ReferencePopup'

export default function AppShell() {
  const { id, pane } = useParams<{ id?: string; pane?: string }>()
  const listMatch = useMatch('/projects/list')
  const knowledgeMatch = useMatch('/knowledge')

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg)' }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Topbar />
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
          {!id && !listMatch && !knowledgeMatch && <AllProjects />}
          {knowledgeMatch && <GlobalKnowledge />}
          {listMatch && <ProjectsList />}
          {id && pane === 'knowledge' && <GlobalKnowledge />}
          {id && pane !== 'knowledge' && <ProjectPage projectId={id} pane={pane ?? 'overview'} />}
        </div>
      </div>
      <ReferencePopup />
    </div>
  )
}
