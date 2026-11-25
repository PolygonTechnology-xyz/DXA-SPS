import { Suspense } from "react";
import { ResourcesView } from "./ResourcesView";

export default function Page() {
  return (
    <Suspense fallback={<div className="section-body">Loading…</div>}>
      <ResourcesView />
    </Suspense>
  );
}
