import { Suspense } from "react";
import { MinutesReview } from "./MinutesReview";

export default function MeetingPage() {
  return (
    <Suspense fallback={<div className="section-body">Loading…</div>}>
      <MinutesReview />
    </Suspense>
  );
}
