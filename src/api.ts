export interface Environment {
  id: string;
  name: string;
  classification: string;
}

export interface Component {
  componentId: string;
  name: string;
  type: string;
  currentVersion: number;
  folderName: string;
  branchName: string;
  modifiedDate: string | null;
  modifiedBy: string;
}

export interface Deployment {
  componentId: string;
  componentName: string;
  packageVersion: string;
  deployedDate: string | null;
  deployedBy: string;
}

export interface EnvironmentDeployment {
  environment: Environment;
  deployments: Deployment[];
}

export interface WorkflowRun {
  id: number;
  runNumber: number;
  name: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  durationMs: number | null;
  url: string;
  actor: string;
  branch: string;
  issue: { number: number; url: string; state: string; target: string } | null;
}

export interface PendingRun {
  runId: number;
  url: string;
  environments: Array<{ name: string; reviewers: string[] }>;
}

export interface DeployRequest {
  componentId: string;
  version: string;
  target: "dev" | "dev-and-production";
  notes: string;
}

export interface DeploymentPlan {
  componentId: string;
  componentName: string;
  sourceRevision: number;
  version: string;
  target: DeployRequest["target"];
  environments: Array<{
    key: "dev" | "prod";
    name: string;
    exists: boolean;
    currentVersion: string | null;
    currentComponentRevision: string | number | null;
    deployedDate: string | null;
    deployedBy: string | null;
    requestedVersion: string;
    action: "install" | "upgrade";
  }>;
}

export interface RollbackCandidate {
  packageId: string;
  packageVersion: string;
  deployedDate: string | null;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed with status ${response.status}.`);
  return data as T;
}

export const api = {
  environments: () => request<Environment[]>("/api/environments"),
  components: () => request<Component[]>("/api/components"),
  deployed: () => request<EnvironmentDeployment[]>("/api/deployed"),
  deploymentPlan: (componentId: string, version: string, target: DeployRequest["target"]) => request<DeploymentPlan>(`/api/deployment-plan?componentId=${encodeURIComponent(componentId)}&version=${encodeURIComponent(version)}&target=${encodeURIComponent(target)}`),
  rollbackCandidates: (componentId: string, environmentId: string) => request<RollbackCandidate[]>(`/api/rollback-candidates?componentId=${encodeURIComponent(componentId)}&environmentId=${encodeURIComponent(environmentId)}`),
  versions: (componentId: string) => request<string[]>(`/api/versions?componentId=${encodeURIComponent(componentId)}`),
  runs: () => request<WorkflowRun[]>("/api/runs"),
  pending: () => request<PendingRun[]>("/api/pending"),
  deploy: (input: DeployRequest) => request<{ message: string; issue: { number: number; url: string }; actionsUrl: string }>("/api/deploy", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  rollback: (input: { componentId: string; environmentId: string; packageId: string }) => request<{ message: string; issue: { number: number; url: string }; actionsUrl: string }>("/api/rollback", {
    method: "POST",
    body: JSON.stringify(input),
  }),
};
