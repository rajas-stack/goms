# Shared Agent Workflow

Claude, Codex/ChatGPT, and Gemini share this working directory. Read this file,
`git status`, and relevant local diffs before editing. Include saved changes from
all three tools in builds. Do not overwrite another tool's work, change the active
branch, reset the index, or create a separate implementation without reconciling it.

- Local hosting uses **http://localhost:8088**, through the existing Docker stack.
- Complete the domain, API, and production frontend builds before hosting.
- Use `npm run sync:local` to capture and build an isolated source snapshot. Build
  outputs, logs, and locks live outside the shared source folder.
- The scheduled sync runs every two hours at 00:00, 02:00, ..., 22:00 IST.
  Successful runs at 00:00, 04:00, ..., 20:00 publish to `origin/Shubham_Side`.
- Build failures leave the last working stack running. Never delete database
  volumes, force-push, or alter the user's shared HEAD/index to publish a snapshot.
- The user controls the main browser and working branch. Do not focus, navigate,
  sign in, or reload their browser. Verification uses a separate browser context.
- `npm run sync:pause` pauses automation; `npm run sync:resume` resumes it.
  Check the pause flag again before deployment and before a remote push.
- Preserve application email values. Use the verified GitHub noreply identity
  `248140904+shubhamrmehra-ship-it@users.noreply.github.com` for new commit metadata.
  Never disable GitHub email privacy or push a private author/committer address.
  The automated publisher creates a privacy-safe snapshot commit without rewriting
  the shared local branch. Source files and application email IDs stay unchanged.

See `docs/local-sync.md` for controls, logs, and rollback.
