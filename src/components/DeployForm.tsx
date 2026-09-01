import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, ExternalLink, PackagePlus, Rocket } from "lucide-react";
import { api, type Component, type DeploymentPlan, type DeployRequest } from "../api";

interface DeployFormProps {
  components: Component[];
  loading: boolean;
  error: string;
  onStarted: () => void;
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function nextVersion(versions: string[]) {
  if (versions.length === 0) return "1.0";
  const parts = [...versions].sort(compareVersions).at(-1)!.split(".").map(Number);
  parts[parts.length - 1] += 1;
  return parts.join(".");
}

export function DeployForm({ components, loading, error, onStarted }: DeployFormProps) {
  const [componentId, setComponentId] = useState("");
  const [version, setVersion] = useState("");
  const [target, setTarget] = useState<DeployRequest["target"]>("dev");
  const [notes, setNotes] = useState("");
  const [versions, setVersions] = useState<string[]>([]);
  const [versionLoading, setVersionLoading] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  const [issueUrl, setIssueUrl] = useState("");
  const [actionsUrl, setActionsUrl] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [checkingPlan, setCheckingPlan] = useState(false);
  const [plan, setPlan] = useState<DeploymentPlan | null>(null);
  const selectedComponent = components.find((component) => component.componentId === componentId);

  useEffect(() => {
    if (!componentId) {
      setVersions([]);
      setVersion("");
      setFieldError("");
      return;
    }
    let active = true;
    setVersionLoading(true);
    setFieldError("");
    api.versions(componentId)
      .then((items) => {
        if (!active) return;
        setVersions(items);
        setVersion(nextVersion(items));
      })
      .catch((requestError: Error) => active && setFieldError(requestError.message))
      .finally(() => active && setVersionLoading(false));
    return () => { active = false; };
  }, [componentId, components]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError("");
    setSuccess("");
    setIssueUrl("");
    setActionsUrl("");
    if (!componentId) return setSubmitError("Select a process.");
    if (!version.trim()) return setFieldError("Enter a package version.");
    if (!/^\d+(?:\.\d+)*$/.test(version)) return setFieldError("Use numeric version parts such as 1.1.");
    if (versions.includes(version)) return setFieldError(`Version ${version} already exists.`);
    setCheckingPlan(true);
    try {
      setPlan(await api.deploymentPlan(componentId, version, target));
      setConfirming(true);
    } catch (requestError) {
      setSubmitError(requestError instanceof Error ? requestError.message : "Could not compare deployed versions.");
    } finally {
      setCheckingPlan(false);
    }
  }

  async function confirmDeployment() {
    setConfirming(false);
    setSubmitting(true);
    try {
      const result = await api.deploy({ componentId, version, target, notes });
      setSuccess(result.message);
      setIssueUrl(result.issue.url);
      setActionsUrl(result.actionsUrl);
      window.setTimeout(onStarted, 3000);
    } catch (requestError) {
      setSubmitError(requestError instanceof Error ? requestError.message : "Could not start deployment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel deploy-panel" aria-labelledby="deploy-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Release control</p><h2 id="deploy-heading">New deployment</h2></div>
        <PackagePlus size={20} aria-hidden="true" />
      </div>
      {error && <p className="error-banner">{error}</p>}
      <form onSubmit={submit}>
        <label>Process<select value={componentId} onChange={(event) => setComponentId(event.target.value)} disabled={loading || components.length === 0}>
          <option value="">{loading ? "Loading processes..." : "Select a process"}</option>
          {components.map((component) => <option value={component.componentId} key={component.componentId}>{component.name}</option>)}
        </select></label>

        <div className="form-pair">
          <label>Package version<input value={version} onChange={(event) => { setVersion(event.target.value); setFieldError(""); }} placeholder={versionLoading ? "Checking..." : "1.1"} disabled={!componentId || versionLoading} aria-invalid={Boolean(fieldError)} /></label>
          <label>Release path<select value={target} onChange={(event) => setTarget(event.target.value as DeployRequest["target"])}>
            <option value="dev">DV only</option>
            <option value="dev-and-production">DV then PD (approval required)</option>
          </select></label>
        </div>
        {fieldError && <p className="field-error">{fieldError}</p>}

        <label>Release notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="What changed in this release?" rows={3} /></label>
        <div className="route-preview" aria-label="Deployment route">
          <span><Rocket size={15} /> Package</span><ArrowRight size={14} />
          <span className="approval-step">DV approval</span><ArrowRight size={14} /><span>DV</span>
          {target === "dev-and-production" && <><ArrowRight size={14} /><span className="approval-step">PD approval</span><ArrowRight size={14} /><span>PD</span></>}
        </div>
        {submitError && <p className="error-banner">{submitError}</p>}
        {success && <div className="success-banner"><CheckCircle2 size={16} /><span>{success}</span><span className="success-links">{actionsUrl && <a href={actionsUrl} target="_blank" rel="noreferrer">Open GitHub Actions <ExternalLink size={13} /></a>}{issueUrl && <a href={issueUrl} target="_blank" rel="noreferrer">View audit issue <ExternalLink size={13} /></a>}</span></div>}
        <button className="primary-button" type="submit" disabled={submitting || checkingPlan || loading || !componentId}>
          <Rocket size={17} /> {submitting ? "Starting..." : checkingPlan ? "Comparing environments..." : "Start deployment"}
        </button>
      </form>
      {confirming && (
        <div className="confirmation-backdrop" role="presentation" onMouseDown={() => setConfirming(false)}>
          <div className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-heading" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">Confirm release request</p>
            <h3 id="confirm-heading">Start this deployment?</h3>
            <dl>
              <div><dt>Process</dt><dd>{selectedComponent?.name}</dd></div>
              <div><dt>Version</dt><dd>{version}</dd></div>
              <div><dt>Path</dt><dd>{target === "dev" ? "DV only" : "DV then PD"}</dd></div>
              <div><dt>Notes</dt><dd>{notes || "No release notes"}</dd></div>
            </dl>
            <div className="plan-comparison">
              {plan?.environments.map((environment) => (
                <div key={environment.key}>
                  <strong>{environment.name}</strong>
                  <span>{environment.currentVersion ? `v${environment.currentVersion}` : "Not deployed"}</span>
                  <ArrowRight size={14} />
                  <span>v{environment.requestedVersion}</span>
                  <small>{environment.action === "upgrade" ? "Upgrade" : "New deployment"}</small>
                </div>
              ))}
            </div>
            <p className="confirmation-note">GitHub will open an audit issue and wait for approval before deploying to DV. Comparison uses Boomi revision and deployment metadata; process XML remains in Boomi.</p>
            <div className="confirmation-actions">
              <button type="button" className="secondary-button" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="primary-button" onClick={confirmDeployment}><Rocket size={17} /> Confirm and start</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
