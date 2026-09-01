import { useEffect, useState } from "react";
import { Activity, CircleDot, ShieldCheck } from "lucide-react";
import { api, type Component, type Environment, type EnvironmentDeployment, type PendingRun, type WorkflowRun } from "./api";
import { DeployForm } from "./components/DeployForm";
import { EnvironmentStatus } from "./components/EnvironmentStatus";
import { RunHistory } from "./components/RunHistory";
import "./styles.css";

interface Loadable<T> { data: T; loading: boolean; error: string }
const initial = <T,>(data: T): Loadable<T> => ({ data, loading: true, error: "" });

export default function App() {
  const [environments, setEnvironments] = useState<Loadable<Environment[]>>(initial([]));
  const [components, setComponents] = useState<Loadable<Component[]>>(initial([]));
  const [deployed, setDeployed] = useState<Loadable<EnvironmentDeployment[]>>(initial([]));
  const [runs, setRuns] = useState<Loadable<WorkflowRun[]>>(initial([]));
  const [pending, setPending] = useState<PendingRun[]>([]);

  function loadRuns(showLoading = false) {
    if (showLoading) setRuns((current) => ({ ...current, loading: true, error: "" }));
    Promise.all([api.runs(), api.pending()])
      .then(([runData, pendingData]) => {
        setRuns({ data: runData, loading: false, error: "" });
        setPending(pendingData);
      })
      .catch((error: Error) => setRuns((current) => ({ ...current, loading: false, error: error.message })));
  }

  useEffect(() => {
    api.environments().then((data) => setEnvironments({ data, loading: false, error: "" })).catch((error: Error) => setEnvironments({ data: [], loading: false, error: error.message }));
    api.components().then((data) => setComponents({ data, loading: false, error: "" })).catch((error: Error) => setComponents({ data: [], loading: false, error: error.message }));
    api.deployed().then((data) => setDeployed({ data, loading: false, error: "" })).catch((error: Error) => setDeployed({ data: [], loading: false, error: error.message }));
    loadRuns();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadRuns();
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const operational = !environments.loading && !environments.error;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Boomi Deployment Console home"><span className="brand-symbol"><Activity size={19} /></span><span>Boomi <strong>Deployment Console</strong></span></a>
        <div className="system-status"><CircleDot size={14} className={operational ? "online" : "pending"} /><span>{operational ? `${environments.data.length} environments connected` : "Connecting"}</span></div>
      </header>

      <main>
        <div className="page-intro">
          <div><p className="eyebrow">Release operations</p><h1>Promote with confidence.</h1><p className="intro-copy">One package, verified in Dev, promoted unchanged to Production.</p></div>
          <div className="security-note"><ShieldCheck size={20} /><span>Protected by GitHub approval</span></div>
        </div>

        <div className="dashboard-grid">
          <EnvironmentStatus data={deployed.data} loading={deployed.loading} error={deployed.error} />
          <DeployForm components={components.data} loading={components.loading} error={components.error} onStarted={() => loadRuns(true)} />
          <RunHistory runs={runs.data} pending={pending} loading={runs.loading} error={runs.error} onRefresh={() => loadRuns(true)} />
        </div>
      </main>
      <footer><span>Release data from Boomi Platform API</span><span>Actions audit trail retained in GitHub</span></footer>
    </div>
  );
}
