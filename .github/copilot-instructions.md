# Boomi CI/CD Repository Instructions

This repository deploys Boomi Integration components through GitHub Actions.
Follow these rules for every change.

## Architecture

- GitHub stores only the release manifest, workflow, scripts, and audit history.
- Boomi stores all process, map, profile, connection, and component source.
- Never export, edit, or re-import Boomi component XML.
- Create each packaged component once and promote that same immutable package to
  Dev and Prod. Environment differences belong in Boomi Environment Extensions.
- Keep `manifests/release.json` as the reviewed human release decision.
- Preserve the artifact handoff between GitHub jobs. Never package again in the
  Prod job.

## Platform API

Use the Boomi Platform REST API:

- US: `https://api.boomi.com/api/rest/v1/{accountId}/`
- GB: `https://api.platform.gb.boomi.com/api/rest/v1/{accountId}/`

The API host is configurable through `BOOMI_API_HOST`; the US host is the
default. Every request must send Basic authentication, `Content-Type:
application/json`, and `Accept: application/json`. Without the Accept header,
Boomi returns XML.

Authentication uses:

- Username: the literal `BOOMI_TOKEN.` prefix followed by the user's email.
- Password: the Boomi Platform API token.

The current API schemas were verified against the live Boomi API reference on
2026-09-01:

- `POST Environment/query` with `{}` returns a `result` array containing `id`,
  `name`, and `classification`.
- `POST PackagedComponent` accepts `componentId`, `packageVersion`, and `notes`;
  the response contains `packageId`.
- `POST DeployedPackage` accepts `environmentId`, `packageId`, and `notes`; the
  response contains `deploymentId`.

Verify the live schema at `developer.boomi.com` before adding any other API
object or action. Environment Extensions, process execution, process schedules,
multi-account promotion, and exported XML analysis are out of scope.

## Credentials

- Never write an account ID, username, or token literal into repository files,
  comments, examples, or test fixtures.
- Read credentials only from `BOOMI_ACCOUNT_ID`, `BOOMI_USERNAME`, and
  `BOOMI_TOKEN`.
- GitHub Actions must obtain them from repository secrets with the same names.
- Never create or recommend a `.env` file.
- Never print a token. Never put credentials in the manifest or code.
- Keep `packages.json`, `.env`, and `*.token` ignored by git.

## Implementation

- Support Python 3.8+ and use only the standard library.
- Keep paths aligned with `scripts/boomi.py`, `manifests/release.json`, and
  root-level `packages.json`.
- Preserve the `check`, `package`, and `deploy <target>` commands.
- Fail clearly when configuration is missing or malformed.
- On HTTP errors, show the status, endpoint, and Boomi response body without
  exposing credentials. Prefix fatal messages with `::error::`.
- Print progress for every component.
- A duplicate package version must tell the user to bump the manifest version.
- Do not concatenate CLI input into API URLs.

## Workflow

The workflow must run for manual dispatch and changes to
`manifests/release.json` on `main`. Preserve these sequential jobs:

1. `package`: create packages and upload `packages.json`.
2. `deploy-dev`: download the artifact and deploy to Dev.
3. `deploy-prod`: after Dev, use GitHub environment `production`, download the
   same artifact, and deploy to Prod.

The `production` GitHub Environment must have Required reviewers enabled to
provide the human approval gate.

## References

- https://developer.boomi.com/docs/APIs/PlatformAPI/Introduction/Platform_API
- https://developer.boomi.com/docs/APIs/PlatformAPI/Usecases/Automating_deployments_api_usecase
- https://developer.boomi.com/docs/api/platformapi/PackagedComponent
- https://developer.boomi.com/docs/api/platformapi/DeployedPackage