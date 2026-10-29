# Shared Local Builds

The built local preview on **5173** is kept running separately from the Docker stack on 8088.
Install its Windows startup task with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-dev-server.ps1`.
It starts at sign-in, checks the preview every 15 seconds and restarts it after an exit or six failed health checks.
Run `npm run build:preview` to build all saved frontend changes into a new directory outside the source tree.
Only successful builds replace the preview; a failed build leaves the previous release online.
The preview serves compiled assets, avoiding dependency-cache failures during development.
It also retains hashed assets from preceding preview releases (and the preceding `dist` build),
so an already-open tab can still load its older route chunks after a new build.
Unknown `/assets/` requests return 404 instead of the SPA's HTML page.
A repeating one-minute trigger also recovers the supervisor itself if its process disappears.
Both `http://localhost:5173` and `http://127.0.0.1:5173` use the IPv4 loopback listener.
Status and logs live in `../.goms-dev-server/`. Windows must be running and the user signed in.
To remove automatic startup, run the installer with `-Uninstall`.
For optional hot reload use `npm run dev -- --port 5174`; keep 5173 reserved for the supervised preview.

Claude, Codex/ChatGPT, and Gemini currently use one Git worktree. The sync captures
all Git-tracked files and all non-ignored untracked files, including saved edits
from each tool. Unsaved editor buffers and chat-only proposals are not source.
Extra worktrees or unresolved conflicts stop the sync for reconciliation.

## Commands

```powershell
npm run sync:local
npm run sync:status
npm run sync:pause
npm run sync:resume
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-sync.ps1
```

The Windows task runs at 00:00, 02:00, ..., 22:00 IST. It runs as the signed-in
user, so Windows and Docker Desktop must be running. Successful 00:00, 04:00,
08:00, 12:00, 16:00, and 20:00 runs also push to `origin/Shubham_Side`.
To remove it, run the install script with `-Uninstall`.

## Isolation And Control

Snapshots and logs are stored in `../.goms-sync/runs/`; the latest status is in
`../.goms-sync/status.json`. The pipeline builds versioned Docker images from a
stable snapshot of all saved source. The domain, API, and complete production
frontend builds finish before the running web/API stack is updated on port 8088.
It rechecks for updates after building and recaptures if another tool saved edits.
No build outputs are written into the shared source tree. The running PostgreSQL
volume is retained. Application services may restart
briefly after successful builds; no browser is focused, signed in, or reloaded.
Pause is checked before building, deployment, and remote publication.

## GitHub Email Privacy

Application email values and local Git identity settings are unchanged. Automated
publication uses `248140904+shubhamrmehra-ship-it@users.noreply.github.com` as the
author and committer address. It makes one validated snapshot commit on top of
the remote branch with an isolated Git index, so unpublished local commits that
contain private email metadata are not sent to GitHub. Local HEAD/history and
the user's index remain unchanged. Keep both GitHub email privacy options enabled.

Remote pushes never use force. Independent remote updates stop publication until
they are reconciled; another agent's remote work is never overwritten. Since the
shared local branch is deliberately preserved, GitHub Desktop may show remote
snapshot commits separately until the user reconciles their local branch.

## Recovery

A failed build leaves the existing containers running. Build logs name the
failing stage. Deployment failures are reported in the status file. The previous
versioned images remain available; do not run `docker compose down -v` or prune
the database volume. `current-release.json` records the last successful Compose
arguments and images for an explicit rollback. Database schema rollback is a
separate operation and is never automated.
