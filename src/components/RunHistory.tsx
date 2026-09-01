import { ExternalLink, GitBranch, RotateCw } from "lucide-react";
import type { PendingRun, WorkflowRun } from "../api";
import { StatusPill } from "./StatusPill";

interface RunHistoryProps {
  runs: WorkflowRun[];
  pending: PendingRun[];
  loading: boolean;
  error: string;
  onRefresh: () => void;
}

function relativeTime(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) >= 86400) return formatter.format(Math.round(seconds / 86400), "day");
  if (Math.abs(seconds) >= 3600) return formatter.format(Math.round(seconds / 3600), "hour");
  return formatter.format(Math.round(seconds / 60), "minute");
}

export function RunHistory({ runs, pending, loading, error, onRefresh }: RunHistoryProps) {
  const pendingByRun = new Map(pending.map((item) => [item.runId, item]));
  return (
    <section className="panel runs-panel" aria-labelledby="runs-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">GitHub Actions</p><h2 id="runs-heading">Recent runs</h2></div>
        <button className="icon-button" onClick={onRefresh} title="Refresh runs" aria-label="Refresh runs"><RotateCw size={18} /></button>
      </div>
      {loading && <div className="skeleton-list" aria-label="Loading runs"><div /><div /><div /></div>}
      {error && <p className="error-banner">{error}</p>}
      {!loading && !error && runs.length === 0 && <p className="empty-state roomy">No workflow runs yet.</p>}
      {!loading && !error && (
        <div className="run-list">
          {runs.map((run) => {
            const approval = pendingByRun.get(run.id);
            return (
              <a className="run-row" href={run.url} target="_blank" rel="noreferrer" key={run.id}>
                <span className="run-icon"><GitBranch size={17} /></span>
                <span className="run-main"><strong>{run.name}</strong><small>#{run.id} · {run.actor}</small></span>
                <span className="run-meta">
                  <StatusPill status={run.status} conclusion={run.conclusion} />
                  <time dateTime={run.createdAt} title={new Date(run.createdAt).toLocaleString()}>{relativeTime(run.createdAt)}</time>
                </span>
                <ExternalLink size={15} aria-hidden="true" />
                {approval && <span className="approval-note">Waiting on {approval.environments.flatMap((item) => item.reviewers).join(", ") || "reviewer"}</span>}
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
