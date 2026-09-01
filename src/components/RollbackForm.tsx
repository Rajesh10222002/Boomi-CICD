import { useEffect, useState } from "react";
import { ExternalLink, RotateCcw } from "lucide-react";
import { api, type Component, type Environment, type RollbackCandidate } from "../api";

interface RollbackFormProps {
  environments: Environment[];
  components: Component[];
  loading: boolean;
  onStarted: () => void;
}

export function RollbackForm({ environments, components, loading, onStarted }: RollbackFormProps) {
  const [environmentId, setEnvironmentId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [candidates, setCandidates] = useState<RollbackCandidate[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [links, setLinks] = useState<{ issue: string; actions: string } | null>(null);
  const targetEnvironments = environments.filter((environment) => ["DV", "PD"].includes(environment.name));
  const selectedComponent = components.find((component) => component.componentId === componentId);
  const selectedEnvironment = environments.find((environment) => environment.id === environmentId);
  const selectedCandidate = candidates.find((candidate) => candidate.packageId === packageId);

  useEffect(() => {
    setPackageId("");
    setCandidates([]);
    setError("");
    if (!componentId || !environmentId) return;
    let active = true;
    setCandidateLoading(true);
    api.rollbackCandidates(componentId, environmentId)
      .then((items) => active && setCandidates(items))
      .catch((requestError: Error) => active && setError(requestError.message))
      .finally(() => active && setCandidateLoading(false));
    return () => { active = false; };
  }, [componentId, environmentId]);

  async function confirmRollback() {
    setConfirming(false);
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const result = await api.rollback({ componentId, environmentId, packageId });
      setMessage(result.message);
      setLinks({ issue: result.issue.url, actions: result.actionsUrl });
      window.setTimeout(onStarted, 3000);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not request rollback.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel rollback-panel" aria-labelledby="rollback-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Recovery</p><h2 id="rollback-heading">Restore package</h2></div>
        <RotateCcw size={20} aria-hidden="true" />
      </div>
      <div className="rollback-form">
        <div className="form-pair">
          <label>Environment<select value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)} disabled={loading}><option value="">Select DV or PD</option>{targetEnvironments.map((environment) => <option value={environment.id} key={environment.id}>{environment.name}</option>)}</select></label>
          <label>Process<select value={componentId} onChange={(event) => setComponentId(event.target.value)} disabled={loading}><option value="">Select process</option>{components.map((component) => <option value={component.componentId} key={component.componentId}>{component.name}</option>)}</select></label>
        </div>
        <label>Previous immutable package<select value={packageId} onChange={(event) => setPackageId(event.target.value)} disabled={candidateLoading || candidates.length === 0}><option value="">{candidateLoading ? "Loading history..." : candidates.length ? "Select package" : "No previous packages"}</option>{candidates.map((candidate) => <option value={candidate.packageId} key={candidate.packageId}>v{candidate.packageVersion} · {candidate.deployedDate ? new Date(candidate.deployedDate).toLocaleString() : "date unknown"}</option>)}</select></label>
        {error && <p className="error-banner">{error}</p>}
        {message && <div className="success-banner"><span>{message}</span><span className="success-links"><a href={links?.actions} target="_blank" rel="noreferrer">Open GitHub Actions <ExternalLink size={13} /></a><a href={links?.issue} target="_blank" rel="noreferrer">View audit issue <ExternalLink size={13} /></a></span></div>}
        <button className="secondary-command" type="button" disabled={!packageId || submitting} onClick={() => setConfirming(true)}><RotateCcw size={17} />{submitting ? "Requesting..." : "Request rollback"}</button>
      </div>
      {confirming && <div className="confirmation-backdrop" role="presentation" onMouseDown={() => setConfirming(false)}><div className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="rollback-confirm-heading" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">Confirm rollback</p><h3 id="rollback-confirm-heading">Restore this package?</h3><dl><div><dt>Process</dt><dd>{selectedComponent?.name}</dd></div><div><dt>Environment</dt><dd>{selectedEnvironment?.name}</dd></div><div><dt>Package</dt><dd>v{selectedCandidate?.packageVersion}</dd></div></dl><p className="confirmation-note">GitHub approval is required. The selected immutable package will be redeployed and verified active.</p><div className="confirmation-actions"><button className="secondary-button" type="button" onClick={() => setConfirming(false)}>Cancel</button><button className="primary-button" type="button" onClick={confirmRollback}><RotateCcw size={17} /> Confirm rollback</button></div></div></div>}
    </section>
  );
}
