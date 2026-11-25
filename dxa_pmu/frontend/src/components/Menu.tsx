"use client";

import { useEffect, useRef, useState } from "react";

/** A button with a small menu that closes on outside click, Escape, or choosing an item. */
export function Menu({ className, buttonClass, label, button, children }: {
  className?: string; buttonClass: string; label: string; button: React.ReactNode; children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className={`menu${className ? ` ${className}` : ""}`} ref={root}>
      <button type="button" className={buttonClass} aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen((v) => !v)}>{button}</button>
      {open && <div className="menu-pop">{children(() => setOpen(false))}</div>}
    </div>
  );
}
