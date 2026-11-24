import type { Health, ProjectStatus } from "@/lib/mock";

const HEALTH_COLOR: Record<Health, string> = {
  "On track": "var(--ok)",
  "At risk": "var(--warn)",
  "Off track": "var(--bad)",
};

export function HealthDot({ health }: { health: Health }) {
  return (
    <span className="health">
      <span className="dot" style={{ background: HEALTH_COLOR[health] }} />
      {health}
    </span>
  );
}

export function StatusChip({ status }: { status: ProjectStatus }) {
  return <span className={`chip status-${status.replace(" ", "-").toLowerCase()}`}>{status}</span>;
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${value}%` }} />
    </div>
  );
}

export const money = (n: number) => "$" + n.toLocaleString("en-US");
