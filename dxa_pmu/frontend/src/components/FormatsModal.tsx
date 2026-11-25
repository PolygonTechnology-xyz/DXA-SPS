"use client";

/** Report and minutes formats (Figma RP-02). */

import { useState } from "react";
import { FormatPanel } from "./FormatPanel";
import { Chips, Modal } from "./ui";

export function FormatsModal({ projectId, initial, onClose }: { projectId: string; initial: "report" | "minutes"; onClose: () => void }) {
  const [kind, setKind] = useState(initial);
  return (
    <Modal wide title="Formats" lead="Upload a Word document you already use. DXA follows its layout and headings. Figures always come from live project data." onClose={onClose}>
      <Chips label="Kind of format" value={kind} onChange={setKind} options={[{ id: "report", label: "Report formats" }, { id: "minutes", label: "Minutes formats" }]} />
      <div className="pd"><FormatPanel key={kind} projectId={projectId} kind={kind} /></div>
      <div className="dlg-actions"><button type="button" className="ds-btn primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}
