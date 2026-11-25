"use client";

/** Building blocks shared by the screens in the Figma file. */

import Link from "next/link";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { FigmaIcon } from "./FigmaIcon";

export const SOON = "Not available yet";

const asDate = (v: string) => new Date(v.length === 10 ? `${v}T00:00:00` : v);
export const shortDate = (v: string) => asDate(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
export const longDate = (v: string) => asDate(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const fileSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

export type Tone = "neutral" | "brand" | "ok" | "warn" | "bad" | "ai";
export const Tag = ({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) => <span className={`tag ${tone}`}>{children}</span>;
export const levelTone = (v: string): Tone => (v === "high" ? "bad" : v === "medium" ? "warn" : "neutral");

export function Avatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return <span className="avatar-sm" aria-hidden>{initials}</span>;
}

export function Person({ name, none = "No owner" }: { name: string | null | undefined; none?: string }) {
  return name ? <span className="person"><Avatar name={name} />{name}</span> : <span className="warn-text">{none}</span>;
}

export function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="chips-row" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.id} className={`filter-chip${value === o.id ? " on" : ""}`} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {value === o.id && <span aria-hidden>✓</span>}{o.label}{o.count === undefined ? "" : ` ${o.count}`}
        </button>
      ))}
    </div>
  );
}

export function Search({ value, onChange, placeholder, full }: { value: string; onChange: (v: string) => void; placeholder: string; full?: boolean }) {
  return (
    <label className={`search-box${full ? " full" : ""}`}>
      <FigmaIcon name="search" size={16} />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

export interface SideItem { id: string; label: string; icon?: string; count?: number; href?: string; disabled?: boolean }
export interface SideGroup { title?: string; items: SideItem[] }

/** A section of a project: breadcrumb bar, the section's own menu, and the page. */
export function Section({ crumbs, actions, menu, active, onSelect, children }: {
  crumbs: { label: string; href?: string }[];
  actions?: React.ReactNode;
  menu?: SideGroup[];
  active?: string;
  onSelect?: (id: string) => void;
  children: React.ReactNode;
}) {
  return (<>
    <header className="topbar">
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={i}>{i > 0 && <i aria-hidden>/</i>}{c.href ? <Link href={c.href}>{c.label}</Link> : <b aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</b>}</span>
        ))}
      </nav>
      <span className="topbar-spacer" />
      {actions}
    </header>
    <div className={`section${menu ? " with-menu" : ""}`}>
      {menu && (
        <nav className="section-menu" aria-label="Section">
          {menu.map((g, i) => (
            <div key={i}>
              {g.title && <h3>{g.title}</h3>}
              {g.items.map((it) => {
                const inner = <>{it.icon && <FigmaIcon name={it.icon} size={18} />}<span>{it.label}</span>{it.count !== undefined && <small>{it.count}</small>}</>;
                return it.href
                  ? <Link key={it.id} href={it.href} className={active === it.id ? "on" : ""}>{inner}</Link>
                  : <button type="button" key={it.id} disabled={it.disabled} title={it.disabled ? SOON : undefined} className={active === it.id ? "on" : ""} aria-current={active === it.id ? "true" : undefined} onClick={() => onSelect?.(it.id)}>{inner}</button>;
              })}
            </div>
          ))}
        </nav>
      )}
      <div className="section-body">{children}</div>
    </div>
  </>);
}

export function PageHead({ title, lead, children }: { title: string; lead?: string; children?: React.ReactNode }) {
  return <div className="page-head"><div><h1>{title}</h1>{lead && <p>{lead}</p>}</div>{children}</div>;
}

export function Modal({ title, lead, onClose, wide, children }: { title: string; lead?: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("keydown", esc); before?.focus(); };
  }, []);
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dlg${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box}>
        <div className="dlg-head"><div><h2>{title}</h2>{lead && <p>{lead}</p>}</div><button type="button" className="dlg-x" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export const ErrorNote = ({ error }: { error: string | null }) => (error ? <div className="note bad" role="alert">⚠ {error}</div> : null);
export const Empty = ({ title, text, children }: { title: string; text?: string; children?: React.ReactNode }) => (
  <div className="empty-box"><strong>{title}</strong>{text && <span>{text}</span>}{children}</div>
);
