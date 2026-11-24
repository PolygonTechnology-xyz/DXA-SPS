"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";

/** Shows the document as it will look in the project's format, with a download button. */
export function PreviewModal({ title, previewPath, docxHref, pdfSrc, onClose }: { title: string; previewPath: string; docxHref: string; pdfSrc?: string; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });

  // Depends only on the path: a parent re-render must not cancel the request and leave the preview empty.
  useEffect(() => {
    let off = false;
    if (pdfSrc) return;
    api<{ html: string }>(previewPath).then((r) => { if (!off) setHtml(r.html); }).catch((e) => { if (!off) setError((e as Error).message); });
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("keydown", esc);
    return () => { off = true; window.removeEventListener("keydown", esc); };
  }, [previewPath, pdfSrc]);

  return createPortal(
    <div className="pv-scrim" onClick={onClose}>
      <div className="pv" role="dialog" aria-label={`Preview: ${title}`} onClick={(e) => e.stopPropagation()}>
        <div className="pv-head">
          <b>{title}</b>
          <span className="pd-actions">
            {pdfSrc ? <a className="pd-btn dark" href={pdfSrc.replace("?inline=1", "")}>⬇ Download PDF</a> : <a className="pd-btn dark" href={docxHref}>⬇ Download Word</a>}
            <button className="pd-btn" onClick={onClose}>Close</button>
          </span>
        </div>
        {pdfSrc ? <iframe className="pv-frame" title={`Preview: ${title}`} src={pdfSrc} /> : error ? <div className="note bad pv-note" role="alert">⚠ {error}</div> : html === null ? <p className="pd-muted pv-note">Preparing preview…</p>
          : <iframe className="pv-frame" title={`Preview: ${title}`} sandbox="" srcDoc={html} />}
      </div>
    </div>,
    document.body,
  );
}
