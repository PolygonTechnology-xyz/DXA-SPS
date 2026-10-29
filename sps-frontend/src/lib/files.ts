import { useQuery } from '@tanstack/react-query'
import { projectsApi, type ProjectFile } from '@/api/projects'

/** What the upload buttons offer: the types the server reads (photos and screenshots too) */
export const UPLOAD_ACCEPT = '.pdf,.doc,.docx,.odt,.rtf,.ppt,.pptx,.odp,.xlsx,.xlsm,.xls,.ods,.txt,.md,.csv,.json,.html,.htm,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp,image/*'

/**
 * The project's files and whether they are all processed. While any file is still being
 * read (converted / indexed in the background) the list refreshes every 1.5 s, and the
 * AS-IS must not start: it would map the process from only part of the documents.
 */
export function useProjectFiles(projectId: string) {
  const q = useQuery<ProjectFile[]>({
    queryKey: ['files', projectId],
    queryFn: () => projectsApi.listFiles(projectId),
    enabled: !!projectId,
    refetchInterval: (query) => (query.state.data?.some((f) => !f.status || f.status === 'processing') ? 1500 : false),
  })
  const files = q.data ?? []
  const processing = files.filter((f) => !f.status || f.status === 'processing').length
  const failed = files.filter((f) => f.status === 'failed' || f.status === 'unsupported')
  return {
    files,
    loaded: q.isSuccess,
    isLoading: q.isLoading,
    processing,
    failed,
    /** true while any file is still being processed — the AS-IS waits for it */
    busy: processing > 0,
    /** "Processing 3 of 10 files…" */
    busyLabel: processing > 0 ? `Processing ${processing} of ${files.length} file${files.length > 1 ? 's' : ''}… the AS-IS can start when all are ready` : '',
  }
}
