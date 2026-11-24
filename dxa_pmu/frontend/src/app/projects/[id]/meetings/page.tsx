import { Suspense } from "react";
import { MeetingsView } from "./MeetingsView";

export default function Page() {
  return <Suspense fallback={null}><MeetingsView /></Suspense>;
}
