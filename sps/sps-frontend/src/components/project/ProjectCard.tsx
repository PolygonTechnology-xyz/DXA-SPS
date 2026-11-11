import { useNavigate } from 'react-router-dom'
import type { Project } from '@/api/projects'

interface Props {
  project: Project
}

export default function ProjectCard({ project }: Props) {
  const navigate = useNavigate()

  return (
    <button
      onClick={() => navigate(`/projects/${project.workspaceId ?? project.id}/overview`)}
      style={{
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
        cursor: 'pointer',
      }}
    >
      <strong>{project.name}</strong>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {project.country && (
          <span
            style={{
              display: 'inline-block',
              fontSize: 12,
              fontWeight: 600,
              padding: '3px 9px',
              borderRadius: 999,
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
            }}
          >
            🏷️ {project.country}
          </span>
        )}
        {project.industry && (
          <span
            style={{
              display: 'inline-block',
              fontSize: 12,
              fontWeight: 600,
              padding: '3px 9px',
              borderRadius: 999,
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
            }}
          >
            🏢 {project.industry}
          </span>
        )}
      </div>
    </button>
  )
}
