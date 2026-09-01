import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp, createServices } from "./index.js";

const env = { DASHBOARD_USERNAME: "operator", DASHBOARD_PASSWORD: "test-password" };
const authorization = `Basic ${Buffer.from("operator:test-password").toString("base64")}`;

function fakeServices() {
  return {
    environments: async () => [{ id: "dev-id", name: "DV", classification: "TEST" }],
    components: async () => [{ componentId: "component-id", name: "Process A", type: "process", currentVersion: 2, approved: true }],
    deployed: async () => [],
    versions: async () => ["1.0", "1.1"],
    runs: async () => [],
    pending: async () => [],
    deploy: async (body) => ({ message: "Deployment started.", received: body, run: null }),
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

test("component catalog includes approved and unapproved Boomi processes", async () => {
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
  assert.equal(catalog.find((component) => component.componentId === "another-process").approved, false);
  assert.equal(catalog.find((component) => component.componentId.startsWith("f88b")).approved, true);
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
