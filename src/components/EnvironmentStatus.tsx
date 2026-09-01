import { Box, Clock3, Server } from "lucide-react";
import type { EnvironmentDeployment } from "../api";

interface EnvironmentStatusProps {
  data: EnvironmentDeployment[];
  loading: boolean;
  error: string;
}

function relativeTime(value: string | null) {
  if (!value) return "time unknown";
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const divisions: Array<[number, Intl.RelativeTimeFormatUnit]> = [[86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [amount, unit] of divisions) {
    if (Math.abs(seconds) >= amount) return formatter.format(Math.round(seconds / amount), unit);
  }
  return formatter.format(seconds, "second");
}

export function EnvironmentStatus({ data, loading, error }: EnvironmentStatusProps) {
  return (
    <section className="panel environment-panel" aria-labelledby="environment-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Runtime state</p><h2 id="environment-heading">Currently live</h2></div>
        <Server size={20} aria-hidden="true" />
      </div>
      {loading && <div className="skeleton-list" aria-label="Loading environments"><div /><div /></div>}
      {error && <p className="error-banner">{error}</p>}
      {!loading && !error && (
        <div className="environment-list">
          {data.map(({ environment, deployments }) => (
            <article className="environment-row" key={environment.id}>
              <div className="environment-identity">
                <span className={`environment-mark ${environment.classification?.toLowerCase() === "production" ? "prod" : "test"}`} />
                <div><h3>{environment.name}</h3><p>{environment.classification || "Unknown class"}</p></div>
              </div>
              <div className="deployment-stack">
                {deployments.length === 0 && <p className="empty-state">No active packages</p>}
                {deployments.map((deployment) => (
                  <div className="deployment-line" key={`${environment.id}-${deployment.componentId}`}>
                    <Box size={16} aria-hidden="true" />
                    <span className="deployment-name">{deployment.componentName}</span>
                    <strong>v{deployment.packageVersion}</strong>
                    <span className="deployment-time" title={deployment.deployedDate ? new Date(deployment.deployedDate).toLocaleString() : "Unknown time"}>
                      <Clock3 size={13} aria-hidden="true" /> {relativeTime(deployment.deployedDate)}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
