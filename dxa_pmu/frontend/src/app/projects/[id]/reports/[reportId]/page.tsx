import { Suspense } from "react";
import { ReportReview } from "./ReportReview";

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="section-body">Loading…</div>}>
      <ReportReview />
    </Suspense>
  );
}
