import { Suspense } from "react";
import { SettingsView } from "./SettingsView";

export default function Page() {
  return (
    <Suspense fallback={<div className="section-body">Loading…</div>}>
      <SettingsView />
    </Suspense>
  );
}
