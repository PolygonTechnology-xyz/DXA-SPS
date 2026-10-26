import FilesPane from '@/components/project/FilesPane'

/** Global Knowledge: the shared library every project's agents can search and cite */
export const GLOBAL_PROJECT = '__global__'

export default function GlobalKnowledge() {
  return (
    <div className="ui-scroll-hover" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 28px 40px' }}>
        <FilesPane projectId={GLOBAL_PROJECT} library />
      </div>
    </div>
  )
}
