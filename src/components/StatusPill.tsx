interface StatusPillProps {
  status: string;
  conclusion?: string | null;
}

export function StatusPill({ status, conclusion }: StatusPillProps) {
  let label = "running";
  let tone = "neutral";

  if (status === "waiting") {
    label = "approval";
    tone = "warning";
  } else if (conclusion === "success") {
    label = "passed";
    tone = "success";
  } else if (conclusion === "failure") {
    label = "failed";
    tone = "danger";
  } else if (conclusion === "cancelled") {
    label = "cancelled";
  } else if (status === "queued" || status === "requested") {
    label = "queued";
  }

  return <span className={`status-pill status-${tone}`}><span aria-hidden="true" />{label}</span>;
}
