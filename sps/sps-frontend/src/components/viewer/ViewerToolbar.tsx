import type { ReactNode } from 'react'
import { Table2, Waypoints, Maximize2 } from 'lucide-react'
import { IconButton, Segmented, Pill, type SegOption } from '@/components/ui'

interface Props<T extends string> {
  tab: T
  onTabChange: (t: T) => void
  /** View options (default: Table / BPMN) */
  tabs?: SegOption<T>[]
  version?: number
  /** In place of the version pill: the version switcher */
  versionSlot?: ReactNode
  /** Short muted text after the version, e.g. "42 steps" */
  info?: ReactNode
  /** Secondary actions (downloads, regenerate) — small buttons */
  actions?: ReactNode
  onExpandToggle?: () => void
  /** The main action, at the end of the row (approve / continue) */
  primary?: ReactNode
}

const DEFAULT_TABS = [
  { value: 'table', label: 'Table', icon: Table2 },
  { value: 'bpmn', label: 'BPMN', icon: Waypoints },
]

/** One compact row above a process: view switch and info on the left, actions on the right */
export default function ViewerToolbar<T extends string>({ tab, onTabChange, tabs, version, versionSlot, info, actions, onExpandToggle, primary }: Props<T>) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
      <Segmented value={tab} onChange={onTabChange} options={tabs ?? (DEFAULT_TABS as SegOption<T>[])} />
      {versionSlot ?? (version != null && <Pill>v{version}</Pill>)}
      {/* the info gives way first (shortened with …) so the buttons stay on this row */}
      <span title={typeof info === 'string' ? info : undefined}
        style={{ flex: '1 1 0', minWidth: 0, color: 'var(--muted)', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {info}
      </span>

      {/* the buttons move as one group: full screen never ends up alone on a row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
        {actions}
        {onExpandToggle && <IconButton icon={Maximize2} label="Full screen" size="sm" onClick={onExpandToggle} />}
        {primary}
      </div>
    </div>
  )
}
