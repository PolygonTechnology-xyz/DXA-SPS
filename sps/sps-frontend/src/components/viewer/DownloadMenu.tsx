import { useEffect, useRef, useState } from 'react'
import { Download, ChevronDown, type LucideIcon } from 'lucide-react'

export interface DownloadItem {
  label: string
  icon: LucideIcon
  /** a file the server makes (a link) … */
  href?: string
  /** … or one made in the browser */
  onClick?: () => void
}

/** Every download of a view behind one "Download" button */
export default function DownloadMenu({ items }: { items: DownloadItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className={`ui-btn ui-btn--sm${open ? ' ui-btn--active' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Download size={15} strokeWidth={1.9} /> Download
        <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
      </button>
      {open && (
        <div role="menu" className="dl-menu">
          {items.map(({ label, icon: Icon, href, onClick }) => href
            ? <a key={label} role="menuitem" href={href} download onClick={() => setOpen(false)}><Icon size={15} strokeWidth={1.8} /> {label}</a>
            : <button key={label} role="menuitem" type="button" onClick={() => { setOpen(false); onClick?.() }}><Icon size={15} strokeWidth={1.8} /> {label}</button>)}
        </div>
      )}
    </div>
  )
}
