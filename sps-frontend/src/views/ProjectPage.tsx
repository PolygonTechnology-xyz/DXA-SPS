import { useState, useEffect } from 'react'
import { useNavigation } from '@/stores/navigation'
import { useSession } from '@/stores/session'
import OverviewPane from '@/components/project/OverviewPane'
import AsIsPane from '@/components/project/AsIsPane'
import ToBePane from '@/components/project/ToBePane'
import FilesPane from '@/components/project/FilesPane'
import OutputsPane from '@/components/project/OutputsPane'
import ChatRail from '@/components/project/ChatRail'
import ProcessingState from '@/components/chat/ProcessingState'
import { stopAsis } from '@/lib/asis'
import { MessageSquare } from 'lucide-react'

type Pane = 'overview' | 'asis' | 'tobe' | 'files' | 'outputs'

interface Props {
  projectId: string
  pane: string
}

export default function ProjectPage({ projectId, pane }: Props) {
  const currentPane = (pane as Pane) ?? 'overview'
  const { isRunning, progressText } = useSession()
  const [chatOpen, setChatOpen] = useState(true)
  // a consent card or review questions arrived — show the chat rail
  const chatOpenRequest = useNavigation((s) => s.chatOpenRequest)
  useEffect(() => { if (chatOpenRequest) setChatOpen(true) }, [chatOpenRequest])
  const reviewWaiting = useNavigation((s) => (s.reviewWaiting?.projectId === projectId ? s.reviewWaiting : null))
  const wide = currentPane === 'overview' || currentPane === 'asis' || currentPane === 'tobe' || currentPane === 'files' || currentPane === 'outputs'

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', minHeight: 0, position: 'relative' }}>
      {/* main content */}
      <div className="ui-scroll-hover" style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {/* AS-IS / TO-BE use nearly the full width for their tables */}
        <div style={{ maxWidth: wide ? 'none' : 820, margin: '0 auto', padding: wide ? '14px 24px 32px 16px' : '28px 28px 40px' }}>
          {currentPane === 'overview' && <OverviewPane projectId={projectId} />}
          {currentPane === 'asis' && <AsIsPane projectId={projectId} />}
          {currentPane === 'tobe' && <ToBePane projectId={projectId} pane={currentPane} />}
          {currentPane === 'files' && <FilesPane projectId={projectId} />}
          {currentPane === 'outputs' && <OutputsPane projectId={projectId} />}
        </div>
      </div>

      {/* AI processing overlay */}
      {/* (the AS-IS and TO-BE pages show the run themselves: the table fills in live) */}
      {isRunning && currentPane !== 'asis' && currentPane !== 'tobe' && (
        <ProcessingState
          progress={progressText}
          onStop={stopAsis}
        />
      )}

      {/* chat rail open button — floats at bottom-right so it's always findable */}
      {!chatOpen && !isRunning && (
        <button
          onClick={() => (reviewWaiting ? useNavigation.getState().focusReview() : setChatOpen(true))}
          className={reviewWaiting ? 'rail-fab--waiting' : undefined}
          style={{
            position: 'absolute',
            right: 24,
            bottom: 28,
            zIndex: 20,
            border: '1px solid var(--line)',
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            borderRadius: 999,
            padding: '11px 20px',
            fontWeight: 600,
            fontSize: 14,
            boxShadow: '0 4px 20px rgba(79,70,229,.28)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            whiteSpace: 'nowrap',
          }}
        >
          <MessageSquare size={17} strokeWidth={1.9} /> Assistant
          {reviewWaiting && <span className="rail-fab__badge" title={`${reviewWaiting.open} review question${reviewWaiting.open > 1 ? 's' : ''} waiting`}>{reviewWaiting.open}</span>}
        </button>
      )}

      {/* chat rail */}
      {chatOpen && <ChatRail projectId={projectId} pane={currentPane} onClose={() => setChatOpen(false)} />}
    </div>
  )
}
