---
name: GitHub push via Replit connector
description: How to push this project's code to GitHub when no raw token is available
---

# GitHub push via Replit connector proxy

The GitHub connection here does NOT expose a raw access token (`listConnections` returns 0 items; only the `@replit/connectors-sdk` proxy works). So `git push` with a token is not possible.

**Rule:** Push code using the GitHub Git Data API through `connectors.proxy("github", path, opts)` — create blobs → tree → commit → update `refs/heads/main`.

**Why:** The proxy injects auth server-side; credentials are never surfaced. Direct calls to the connectors credential endpoint return empty for this repl.

**How to apply:**
- Repo: `rrosee12328-bit/rose-finance-academy` (private)
- Empty repos 409 on blob creation — bootstrap with a Contents API PUT first
- Proxy rate limit is 10 RPS per repl — keep concurrency ≤5 with ~400ms pacing and retry on rate-limit errors
- Script must run from the workspace root (module resolution), not /tmp
- Upload the `git ls-files` list (respects .gitignore)

**Caution:** snapshot pushes replace the entire tree on main — they silently override any commits made to GitHub by other tools. Before pushing, list recent commits on the repo; if there are GitHub-side commits not present locally, merge them into Replit first (fetch changed files at that ref via the Contents API, apply, `npm run db:push` if schema changed).
