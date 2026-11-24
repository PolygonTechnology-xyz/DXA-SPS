import { Suspense } from "react";
import { RisksView } from "./RisksView";

export default function Page() {
  return <Suspense fallback={null}><RisksView /></Suspense>;
}
