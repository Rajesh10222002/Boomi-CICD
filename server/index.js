import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { rateLimit } from "express-rate-limit";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_TTL = 5 * 60 * 1000;
const WORKFLOW_FILE = "deploy.yml";
const TARGETS = new Set(["dev", "dev-and-production"]);

function required(name, env) {
  const value = env[name];
  if (!value) throw new Error(`Server configuration is missing ${name}.`);
  return value;
}

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function basicAuth(env) {
  return (request, response, next) => {
    let username;
    let password;
    try {
      const encoded = request.get("authorization")?.replace(/^Basic\s+/i, "");
      const decoded = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
      [username, password] = decoded.split(/:(.*)/s, 2);
    } catch {
      username = "";
      password = "";
    }

    const expectedUsername = env.DASHBOARD_USERNAME;
    const expectedPassword = env.DASHBOARD_PASSWORD;
    if (!expectedUsername || !expectedPassword || !safeEqual(username || "", expectedUsername) || !safeEqual(password || "", expectedPassword)) {
      response.set("WWW-Authenticate", 'Basic realm="Boomi Deployment Console", charset="UTF-8"');
      return response.status(401).json({ error: "Authentication required." });
    }
    next();
  };
}

function jsonError(error) {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  return message.replace(/(Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/gi, "$1 [redacted]");
}

function createCachedLoader(ttl = CACHE_TTL) {
  const entries = new Map();
  return async (key, loader) => {
    const existing = entries.get(key);
    if (existing && existing.expiresAt > Date.now()) return existing.value;
    const value = await loader();
    entries.set(key, { value, expiresAt: Date.now() + ttl });
    return value;
  };
}

async function loadManifest() {
  const text = await fs.readFile(path.join(ROOT, "manifests", "release.json"), "utf8");
  return JSON.parse(text);
}

export function createServices(env = process.env, fetchImpl = fetch) {
  const cached = createCachedLoader();
  const accountId = () => encodeURIComponent(required("BOOMI_ACCOUNT_ID", env));
  const boomiHost = () => (env.BOOMI_API_HOST || "https://api.boomi.com").replace(/\/$/, "");
  const boomiUsername = () => {
    const value = required("BOOMI_USERNAME", env);
    return value.startsWith("BOOMI_TOKEN.") ? value : `BOOMI_TOKEN.${value}`;
  };

  async function boomi(endpoint, body, contentType = "application/json") {
    const authorization = Buffer.from(`${boomiUsername()}:${required("BOOMI_TOKEN", env)}`).toString("base64");
    const response = await fetchImpl(`${boomiHost()}/api/rest/v1/${accountId()}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": contentType,
        Accept: "application/json",
      },
      body: contentType === "application/json" ? JSON.stringify(body) : body,
    });
    if (!response.ok) {
      throw new Error(`Boomi returned ${response.status} for ${endpoint}.`);
    }
    return response.json();
  }

  async function boomiQuery(objectName, body) {
    const records = [];
    let page = await boomi(`${objectName}/query`, body);
    records.push(...(page.result || []));
    while (page.queryToken) {
      page = await boomi(`${objectName}/queryMore`, page.queryToken, "text/plain");
      records.push(...(page.result || []));
    }
    return records;
  }

  async function github(endpoint, options = {}) {
    const owner = encodeURIComponent(required("GITHUB_OWNER", env));
    const repo = encodeURIComponent(required("GITHUB_REPO", env));
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${required("GITHUB_TOKEN", env)}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    if (response.status === 204) return null;
    if (!response.ok) {
      if (response.status === 403 && endpoint === "/issues") {
        throw new Error("GitHub denied issue creation. Give the fine-grained token Issues: Read and write permission for this repository.");
      }
      if (response.status === 403 && endpoint === "/contents/manifests/release.json") {
        throw new Error("GitHub denied the release manifest update. Give the fine-grained token Contents: Read and write permission for this repository.");
      }
      throw new Error(`GitHub returned ${response.status} for ${endpoint}.`);
    }
    return response.json();
  }

  async function environments() {
    return cached("environments", async () => {
      const records = await boomiQuery("Environment", {});
      return records.map(({ id, name, classification }) => ({ id, name, classification }));
    });
  }

  async function components() {
    return cached("components", async () => {
      const records = await boomiQuery("ComponentMetadata", {
        QueryFilter: {
          expression: {
            operator: "and",
            nestedExpression: [
              { operator: "EQUALS", property: "currentVersion", argument: ["true"] },
              { operator: "EQUALS", property: "deleted", argument: ["false"] },
              { operator: "EQUALS", property: "type", argument: ["process"] },
            ],
          },
        },
      });
      return records
        .filter((record) => record.type === "process" && record.deleted !== true)
        .map(({ componentId, name, type, version }) => ({
          componentId,
          name,
          type,
          currentVersion: version,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
    });
  }

  async function versions(componentId) {
    const allowed = await components();
    if (!allowed.some((component) => component.componentId === componentId)) throw invalid("Select a current Boomi process.");
    const records = await boomiQuery("PackagedComponent", {
      QueryFilter: { expression: { operator: "EQUALS", property: "componentId", argument: [componentId] } },
    });
    return records.filter((record) => !record.deleted).map((record) => record.packageVersion).filter(Boolean);
  }

  async function deployed() {
    const environmentList = await environments();
    return Promise.all(environmentList.map(async (environment) => {
      const records = await boomiQuery("DeployedPackage", {
        QueryFilter: {
          expression: {
            operator: "and",
            nestedExpression: [
              { operator: "EQUALS", property: "environmentId", argument: [environment.id] },
              { operator: "EQUALS", property: "active", argument: ["true"] },
            ],
          },
        },
      });
      return {
        environment,
        deployments: records.map((record) => ({
          componentId: record.componentId,
          componentName: record.componentName || "Unknown component",
          packageVersion: record.packageVersion || "unknown",
          deployedDate: record.deployedDate || null,
          deployedBy: record.deployedBy || "unknown",
        })),
      };
    }));
  }

  async function runs() {
    const data = await github(`/actions/workflows/${WORKFLOW_FILE}/runs?per_page=10`);
    return (data.workflow_runs || []).map((run) => ({
      id: run.id,
      name: run.display_title || run.name,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      url: run.html_url,
      actor: run.actor?.login || "unknown",
    }));
  }

  async function pending() {
    const waitingRuns = (await runs()).filter((run) => run.status === "waiting");
    return Promise.all(waitingRuns.map(async (run) => {
      const deployments = await github(`/actions/runs/${run.id}/pending_deployments`);
      return {
        runId: run.id,
        url: run.url,
        environments: (deployments || []).map((deployment) => ({
          name: deployment.environment?.name || "unknown",
          reviewers: (deployment.reviewers || []).map((entry) => entry.reviewer?.login || entry.reviewer?.name || "unknown"),
        })),
      };
    }));
  }

  async function createReleaseIssue(component, version, target, notes) {
    const currentFile = await github("/contents/manifests/release.json?ref=main");
    const currentManifest = JSON.parse(Buffer.from(currentFile.content.replace(/\s/g, ""), "base64").toString("utf8"));
    const previous = currentManifest.components?.[0] || {};
    const issue = await github("/issues", {
      method: "POST",
      body: JSON.stringify({
        title: `Release ${component.name} ${version}`,
        body: [
          "## Release request",
          "",
          `| Field | Before | Requested |`,
          `| --- | --- | --- |`,
          `| Process | ${previous.name || "None"} | ${component.name} |`,
          `| Component ID | ${previous.id || "None"} | ${component.componentId} |`,
          `| Package version | ${previous.version || "None"} | ${version} |`,
          `| Release path | ${currentManifest.target || "dev-and-production"} | ${target} |`,
          `| Notes | ${String(currentManifest.notes || "None").replace(/\|/g, "\\|")} | ${String(notes || "None").replace(/\|/g, "\\|")} |`,
          "",
          "## Manifest diff",
          "",
          "```diff",
          `- Process: ${previous.name || "None"}`,
          `+ Process: ${component.name}`,
          `- Component ID: ${previous.id || "None"}`,
          `+ Component ID: ${component.componentId}`,
          `- Package version: ${previous.version || "None"}`,
          `+ Package version: ${version}`,
          `- Release path: ${currentManifest.target || "dev-and-production"}`,
          `+ Release path: ${target}`,
          "```",
          "",
          "The workflow will update this issue after deployment completes.",
        ].join("\n"),
      }),
    });

    const manifest = {
      notes: notes || `Release ${component.name} ${version}`,
      target,
      issueNumber: issue.number,
      environments: currentManifest.environments,
      components: [{ name: component.name, id: component.componentId, version }],
    };
    try {
      await github("/contents/manifests/release.json", {
        method: "PUT",
        body: JSON.stringify({
          message: `Release ${component.name} ${version} (#${issue.number})`,
          content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`).toString("base64"),
          sha: currentFile.sha,
          branch: "main",
        }),
      });
    } catch (error) {
      await github(`/issues/${issue.number}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
      }).catch(() => {});
      throw error;
    }
    return { number: issue.number, url: issue.html_url };
  }

  async function deploy(input) {
    const { componentId, version, target, notes = "" } = input;
    const allowed = await components();
    const component = allowed.find((item) => item.componentId === componentId);
    if (!component) throw invalid("Select a current Boomi process.");
    if (!/^\d+(?:\.\d+)*$/.test(version || "")) throw invalid("Version must contain numeric parts such as 1.1.");
    if (!TARGETS.has(target)) throw invalid("Select a valid deployment target.");
    if (notes.length > 500) throw invalid("Release notes must be 500 characters or fewer.");
    if ((await versions(componentId)).includes(version)) throw invalid(`Package version ${version} already exists.`);

    const issue = await createReleaseIssue(component, version, target, notes);
    return {
      message: "Deployment requested. GitHub Actions will wait for DV approval.",
      issue,
    };
  }

  return { environments, components, deployed, versions, runs, pending, deploy };
}

export function createApp({ env = process.env, services = createServices(env) } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use(basicAuth(env));

  const deployLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many deployment requests. Try again in one minute." },
  });

  app.get("/api/environments", asyncRoute(() => services.environments()));
  app.get("/api/components", asyncRoute(() => services.components()));
  app.get("/api/deployed", asyncRoute(() => services.deployed()));
  app.get("/api/versions", asyncRoute((request) => services.versions(String(request.query.componentId || ""))));
  app.get("/api/runs", asyncRoute(() => services.runs()));
  app.get("/api/pending", asyncRoute(() => services.pending()));
  app.post("/api/deploy", deployLimiter, asyncRoute((request) => services.deploy(request.body), 202));

  const distPath = path.join(ROOT, "dist");
  app.use(express.static(distPath));
  app.get("/{*path}", async (request, response, next) => {
    if (request.path.startsWith("/api/")) return next();
    try {
      await fs.access(path.join(distPath, "index.html"));
      response.sendFile(path.join(distPath, "index.html"));
    } catch {
      response.status(503).json({ error: "Dashboard is not built. Run npm run build first." });
    }
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    response.status(error.status || 500).json({ error: jsonError(error) });
  });
  return app;
}

function asyncRoute(handler, status = 200) {
  return async (request, response, next) => {
    try {
      response.status(status).json(await handler(request));
    } catch (error) {
      next(error);
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env;
  required("DASHBOARD_USERNAME", env);
  required("DASHBOARD_PASSWORD", env);
  const port = Number(env.PORT || 3000);
  createApp({ env }).listen(port, "127.0.0.1", () => {
    console.log(`Boomi Deployment Console: http://127.0.0.1:${port}`);
  });
}
