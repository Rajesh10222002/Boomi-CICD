import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp, createServices } from "./index.js";

const env = { DASHBOARD_USERNAME: "operator", DASHBOARD_PASSWORD: "test-password" };
const authorization = `Basic ${Buffer.from("operator:test-password").toString("base64")}`;

function fakeServices() {
  return {
    environments: async () => [{ id: "dev-id", name: "DV", classification: "TEST" }],
    components: async () => [{ componentId: "component-id", name: "Process A", type: "process", currentVersion: 2 }],
    deployed: async () => [],
    versions: async () => ["1.0", "1.1"],
    runs: async () => [],
    pending: async () => [],
    deploy: async (body) => ({ message: "Deployment requested.", received: body, issue: { number: 7, url: "https://github.example/issues/7" } }),
  };
}

async function withServer(callback) {
  const server = createApp({ env, services: fakeServices() }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("API requires authentication", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/environments`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Authentication required." });
  });
});

test("API returns data after authentication", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/components`, { headers: { Authorization: authorization } });
    assert.equal(response.status, 200);
    assert.equal((await response.json())[0].name, "Process A");
  });
});

test("component catalog includes every current Boomi process", async () => {
  const serviceEnv = {
    BOOMI_ACCOUNT_ID: "account",
    BOOMI_USERNAME: "user@example.com",
    BOOMI_TOKEN: "token",
    GITHUB_OWNER: "owner",
    GITHUB_REPO: "repo",
    GITHUB_TOKEN: "github-token",
  };
  const fetchImpl = async (url) => {
    assert.match(url, /ComponentMetadata\/query$/);
    return new Response(JSON.stringify({
      result: [
        { componentId: "f88b602e-605a-4d49-bf27-b7b42951d227", name: "Fetch and Process User Data", type: "process", version: 4, deleted: false },
        { componentId: "another-process", name: "Another Process", type: "process", version: 2, deleted: false },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const catalog = await createServices(serviceEnv, fetchImpl).components();
  assert.equal(catalog.length, 2);
  assert.deepEqual(catalog.map((component) => component.name), ["Another Process", "Fetch and Process User Data"]);
});

test("deploy creates an audit issue and commits a one-component release", async () => {
  const serviceEnv = {
    BOOMI_ACCOUNT_ID: "account",
    BOOMI_USERNAME: "user@example.com",
    BOOMI_TOKEN: "token",
    GITHUB_OWNER: "owner",
    GITHUB_REPO: "repo",
    GITHUB_TOKEN: "github-token",
  };
  const requests = [];
  const currentManifest = {
    notes: "Previous release",
    target: "dev",
    environments: { dev: "e424a5d0-c9c8-4b92-97c1-b0bd6e51dd4d", prod: "bf3c615f-7767-4381-8829-b25358f3538f" },
    components: [{ name: "Old Process", id: "old-id", version: "1.0" }],
  };
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith("/ComponentMetadata/query")) return Response.json({ result: [{ componentId: "new-id", name: "New Process", type: "process", version: 3, deleted: false, folderName: "Shared", branchName: "main", modifiedDate: "2026-08-31T09:00:00Z", modifiedBy: "builder@example.com" }] });
    if (url.endsWith("/Environment/query")) return Response.json({ result: [{ id: "e424a5d0-c9c8-4b92-97c1-b0bd6e51dd4d", name: "DV", classification: "TEST" }, { id: "bf3c615f-7767-4381-8829-b25358f3538f", name: "PD", classification: "PROD" }] });
    if (url.endsWith("/PackagedComponent/query")) return Response.json({ result: [] });
    if (url.endsWith("/DeployedPackage/query")) {
      const query = JSON.parse(options.body);
      const filters = query.QueryFilter.expression.nestedExpression;
      const environmentId = filters.find((filter) => filter.property === "environmentId").argument[0];
      return Response.json({ result: environmentId === "e424a5d0-c9c8-4b92-97c1-b0bd6e51dd4d" ? [{ componentId: "new-id", packageVersion: "1.5", active: true, deployedDate: "2026-08-30T10:00:00Z", deployedBy: "deployer@example.com" }] : [] });
    }
    if (url.includes("/contents/manifests/release.json?ref=main")) return Response.json({ sha: "file-sha", content: Buffer.from(JSON.stringify(currentManifest)).toString("base64") });
    if (url.endsWith("/issues")) return Response.json({ number: 12, html_url: "https://github.example/issues/12" }, { status: 201 });
    if (url.endsWith("/contents/manifests/release.json")) return Response.json({ content: { sha: "new-sha" } });
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await createServices(serviceEnv, fetchImpl).deploy({
    componentId: "new-id",
    version: "2.1",
    target: "dev-and-production",
    notes: "Guard error handling",
  });
  assert.equal(result.issue.number, 12);
  assert.equal(result.actionsUrl, "https://github.com/owner/repo/actions/workflows/deploy.yml");
  const issueRequest = requests.find((request) => request.url.endsWith("/issues"));
  const issueBody = JSON.parse(issueRequest.options.body).body;
  assert.match(issueBody, /\| DV \| v1\.5 \| v2\.1 \| Upgrade \|/);
  assert.match(issueBody, /\| PD \| Not deployed \| v2\.1 \| New deployment \|/);
  assert.match(issueBody, /\*\*Boomi revision:\*\* 3/);
  assert.match(issueBody, /\*\*Folder \/ branch:\*\* Shared \/ main/);
  assert.match(issueBody, /2026-08-30T10:00:00Z \| deployer@example\.com/);
  assert.match(issueBody, /- DV: v1\.5/);
  assert.match(issueBody, /\+ PD: v2\.1 \(new deployment\)/);
  const update = requests.find((request) => request.url.endsWith("/contents/manifests/release.json") && request.options.method === "PUT");
  const updateBody = JSON.parse(update.options.body);
  const release = JSON.parse(Buffer.from(updateBody.content, "base64").toString("utf8"));
  assert.deepEqual(release.components, [{ name: "New Process", id: "new-id", version: "2.1" }]);
  assert.equal(release.target, "dev-and-production");
  assert.equal(release.notes, "Guard error handling");
  assert.equal(release.issueNumber, 12);
  assert.equal(updateBody.branch, "main");
  assert.equal(requests.some((request) => request.url.endsWith("/git/refs") || request.url.endsWith("/pulls")), false);
});

test("deploy endpoint returns accepted response", async () => {
  await withServer(async (baseUrl) => {
    const body = { componentId: "component-id", version: "1.2", target: "dev", notes: "Ready" };
    const response = await fetch(`${baseUrl}/api/deploy`, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 202);
    assert.deepEqual((await response.json()).received, body);
  });
});

test("validation errors retain their client status", async () => {
  const services = fakeServices();
  services.deploy = async () => {
    const error = new Error("Select a valid deployment target.");
    error.status = 400;
    throw error;
  };
  const server = createApp({ env, services }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/deploy`, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ target: "invalid" }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Select a valid deployment target." });
  } finally {
    server.close();
    await once(server, "close");
  }
});
