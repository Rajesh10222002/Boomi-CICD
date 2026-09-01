# Boomi CI/CD with GitHub Actions

This repository uses GitHub Actions as a remote control for Boomi. It creates
each packaged component once, deploys that package to Dev, and promotes the
same package to Prod after a GitHub approval. Boomi components remain in Boomi;
Git records the reviewed release manifest and deployment workflow.

## Prerequisites

1. In Boomi, collect the Account ID from **Settings > Account > Account
   Information**. Create a token at **Settings > My User Settings > Platform API
   Tokens**. The user needs API Access, Package Management, and deployment
   privileges. Get each process component ID from its Build page URL or Revision
   History dialog.
2. Install Python 3.12 or newer and Git. On Windows, select **Add Python to
   PATH** during Python installation.
3. Set credentials in the current shell. Never put them in this repository or
   in a `.env` file.

   PowerShell:

   ```powershell
   $env:BOOMI_ACCOUNT_ID = Read-Host "Boomi account ID"
   $env:BOOMI_USERNAME = Read-Host "Boomi platform user email"
   $env:BOOMI_TOKEN = Read-Host "Boomi API token" -MaskInput
   ```

   For the European platform, also set:

   ```powershell
   $env:BOOMI_API_HOST = "https://api.platform.gb.boomi.com"
   ```

4. Check API access and list environment IDs:

   ```powershell
   python scripts/boomi.py check
   ```

5. Replace every `REPLACE_WITH` value in `manifests/release.json`. Increment a
   component's `version` for every new package release.
6. Test packaging and the Dev deployment locally:

   ```powershell
   python scripts/boomi.py package
   python scripts/boomi.py deploy dev
   ```

   Confirm it appears in **Boomi > Deploy > Deployments**. Do not run the local
   Prod deployment unless it is an intentional manual release.
7. Create and push the repository:

   ```powershell
   git init
   git add .
   git commit -m "Add Boomi CI/CD pipeline"
   git branch -M main
   git remote add origin YOUR_EMPTY_GITHUB_REPOSITORY_URL
   git push -u origin main
   ```

8. In GitHub, open **Settings > Secrets and variables > Actions** and add these
   repository secrets: `BOOMI_ACCOUNT_ID`, `BOOMI_USERNAME`, and `BOOMI_TOKEN`.
   Set `BOOMI_USERNAME` to the email address used to sign in to Boomi. The
   script adds the API token prefix automatically.
9. Under **Settings > Environments**, create an environment named exactly
   `production` and enable Required reviewers. This pauses the Prod job for
   human approval.
10. In the **Actions** tab, run **Deploy Boomi release** and approve the Prod job
    after the Dev deployment is verified.

## Release Manifest

`manifests/release.json` is the code-reviewed release decision. Commit every
change to it so git history records what was promoted. `packages.json` is a
temporary generated artifact and is intentionally ignored.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 Unauthorized` | Invalid email or token, or no API Access | Confirm the Boomi login email, regenerate the token, and check API Access |
| `403` or entitlement error | API entitlement or privileges are missing | Check account entitlement and user environment roles |
| JSON parse error | Server did not return JSON | Confirm the script sends `Accept: application/json` |
| Package version conflict | Version already exists for the component | Bump `version` in the release manifest |
| Zero environments | Account edition has no environments | Confirm the Boomi account edition and provisioning |
| Required reviewers unavailable | GitHub plan limitation for a private repo | Use a public repo or place the gate on a manual workflow |
| Workflow missing | Incorrect path or invalid YAML | Keep it at `.github/workflows/deploy.yml` |

If the account has only one environment, remove the Prod job and `prod`
manifest entry, then put `environment: production` on the Dev job to retain the
approval demonstration.

## References

- [Boomi Platform API](https://developer.boomi.com/docs/APIs/PlatformAPI/Introduction/Platform_API)
- [Automating deployments](https://developer.boomi.com/docs/APIs/PlatformAPI/Usecases/Automating_deployments_api_usecase)
- [PackagedComponent API](https://developer.boomi.com/docs/api/platformapi/PackagedComponent)
- [DeployedPackage API](https://developer.boomi.com/docs/api/platformapi/DeployedPackage)