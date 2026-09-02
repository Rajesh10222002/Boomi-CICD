# Security

The dashboard browser calls only same-origin `/api` endpoints. The Express
backend holds Boomi and GitHub credentials in process environment variables and
never returns or logs token values.

- Keep `BOOMI_ACCOUNT_ID`, `BOOMI_USERNAME`, `BOOMI_TOKEN`, `GITHUB_TOKEN`,
  `GITHUB_OWNER`, and `GITHUB_REPO` server-side.
- Local credentials may be stored in `.env` (copy `.env.example`) or entered
  through interactive prompts. `.env` is gitignored and only read from disk by
  your own machine; it is never sent to GitHub or read by GitHub Actions.
- Never prefix credentials with `VITE_`, `REACT_APP_`, or `NEXT_PUBLIC_`.
- Use a fine-grained GitHub token restricted to this repository with Actions
  read, Contents read/write, and Issues read/write access.
- Set `DASHBOARD_USERNAME` and a strong `DASHBOARD_PASSWORD`. Every page and API
  endpoint requires HTTP Basic authentication.
- `DASHBOARD_DISABLE_AUTH=true` removes that login entirely. It is an explicit
  opt-in for a single trusted user on a single machine; anything that can reach
  `127.0.0.1` on that machine can then trigger deployments with no credential
  check. Leave it unset (the default) unless you understand that tradeoff.
- The local server binds to `127.0.0.1`. Put it behind company SSO and HTTPS
  before making it reachable from another machine.
- Production approval remains in GitHub's audited environment review screen.
  The dashboard intentionally cannot approve, reject, delete, or undeploy.
- The deployment endpoint is limited to 10 requests per minute per client.

Never commit credential files, tokens, generated `packages.json`, or dashboard
build output. Rotate a token immediately if it is exposed.