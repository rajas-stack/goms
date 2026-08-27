# GOMS Production Rollback Runbook

**Status:** Written ahead of production existing. `goms-prod` has not been provisioned — this runbook documents the procedure to use once it does, and doubles as the operational detail behind Stage B plan §4. Nothing in this document has been executed against any real environment.

**Who can run this:** whoever holds `roles/run.admin` on the `goms-prod` GCP project (the same role `infra/prod/wif.tf`'s `goms-ci-deploy` service account has for CI deploys — a human operator needs the equivalent, granted separately, not covered by this doc).

---

## The one rule to hold in your head

**Rolling back a Cloud Run revision does not roll back a database migration.** These are two independent systems that happen to often break together. Treat every incident as two separate questions:

1. Is the *app code* bad? → §1 (instant, safe, always try this first).
2. Is the *database schema/data* bad? → §2 (slower, needs judgment, sometimes destructive).

A bad deploy can trigger either, both, or neither. Don't assume rolling back the app fixed the database, and don't assume the database is fine just because the app rollback made the symptoms go away.

---

## 0. Pre-cutover checks — reduce how often this runbook is needed at all

Run these before any production deploy (dev-to-prod promotion of an already-`goms-dev`-validated image, per architecture doc §18 — prod never rebuilds, it promotes the exact image tag dev already ran) and, separately, before the very first DNS cutover to `goms-prod`:

**Before every production deploy:**
- [ ] The image tag being deployed to `goms-prod` is the exact `$CI_COMMIT_SHA` tag already smoke-tested on `goms-dev` — never a fresh build. This is what makes §1's rollback meaningful: the "last known good" revision is a real, previously-verified artifact, not a guess.
- [ ] Any migration in this deploy has been classified against §2.1/§2.2 *before* shipping, not discovered during an incident — write it down (a one-line note in the deploy record: "additive" or "destructive, down-migration written and tested against a copy of prod data").
- [ ] If destructive, the `down` migration exists and was actually run against a throwaway copy of the current schema/data to confirm it doesn't error — "wrote a down function" and "verified it works" are different claims; only the second is safe to rely on mid-incident.
- [ ] Monitoring's uptime check + alert policies (Stage B plan §3) are applied and green immediately beforehand — deploying blind, with no alerting in place, means the first sign of trouble is a user report instead of a page.

**Before the first-ever DNS cutover specifically** (architecture doc §19.2):
- [ ] `goms-prod` has been validated end-to-end under its temporary hostname (Cloud Run's default `*.run.app`, or a preview subdomain) — every screen in the Stage B plan's full remote-mode regression, not just `health.check`.
- [ ] §1's rollback command has been rehearsed at least once against `goms-prod` under that temporary hostname (deploy a trivial follow-up revision, then roll it back) — the first time anyone runs `gcloud run services update-traffic` against prod should not be during a real incident.
- [ ] Production DNS TTL has already been lowered in advance of the cutover window, per architecture doc §19.2 — a high TTL turns even a successful rollback into a slow one, since DNS-level traffic can't be redirected quickly regardless of how fast Cloud Run itself reacts.

---

## 1. Cloud Run revision rollback

Cloud Run keeps every prior revision and supports instant traffic-shifting between them — this is a platform capability that already exists, not something this runbook builds. It's also already been used for real: Stage A used this exact command twice against `goms-dev` during the 2026-08-26 dev cutover (revisions `goms-api-00019-78x` → `goms-api-00020-vj7`).

### 1.1 Identify the last known good revision

```bash
gcloud run revisions list --service=goms-api --project=goms-prod --region=asia-south1
```

This lists every revision still retained by Cloud Run, newest first, with its creation time and current traffic percentage. Cross-reference against deploy history (the commit SHA each revision was built from — CI tags images by commit SHA per the architecture doc §18) to identify the last revision known to be good, i.e. the one deployed immediately before the change now suspected of causing the incident.

### 1.2 Shift traffic back to it

```bash
gcloud run services update-traffic goms-api --project=goms-prod --region=asia-south1 \
  --to-revisions=<last-good-revision>=100
```

This is instant — Cloud Run doesn't rebuild or redeploy anything, it just starts routing 100% of new requests to the already-running container image of the specified revision. The bad revision's container is untouched and still exists (so this is itself reversible, if it turns out the "last good" pick was wrong — just run the command again with a different revision name).

### 1.3 What this does and does not undo

| Does | Does not |
|---|---|
| Changes which container image serves new requests, immediately | Touch the database in any way |
| Reverts any bug introduced purely in application code (bad logic, a bad dependency, a crash-on-startup) | Undo a schema migration applied by a separate `goms-migrate` job run |
| Is safe to run repeatedly, in either direction, with no side effects beyond routing | Undo data written by the bad revision while it was live (those writes used whatever schema existed at the time, correct or not) |

If the incident was caused purely by bad application code (no migration involved), §1 alone is the complete fix. If a migration shipped in the same deploy, continue to §2 regardless of whether §1 made things look better — a schema change can be silently wrong (e.g., a bad default value, a bug in a data backfill) without causing any symptom that Cloud Run rollback would visibly fix.

---

## 2. Database migration recovery — a separate assessment, not an automatic step

`node-pg-migrate` migrations are applied via the `goms-migrate` Cloud Run Job (`infra/prod/cloudrun.tf`, once it exists) and are **permanent** changes to the live schema/data the moment that job completes — there is no automatic linkage to which app revision is currently serving traffic. Assess every migration that shipped alongside an incident individually:

### 2.1 Is the migration additive/backward-compatible?

Examples: a new nullable column, a new table, a new index, a new constraint that doesn't reject existing rows.

**If yes: no action needed.** The rolled-back (old) app code simply never references the new schema element — it's inert from the old code's point of view. This is the case every production migration should be written to hit, by following an **expand/contract** pattern:

- **Expand** — add the new schema first (new nullable column, new table), in its own migration, deployed *before* any app code depends on it.
- Deploy app code that uses the new schema, verify it's healthy.
- **Contract** — only in a later, separate migration, drop/rename/tighten the old schema once the new code has been running safely for a while.

Written this way, §1's instant app rollback is *always* sufficient on its own — there's never a moment where the currently-live schema requires a specific app revision to function correctly.

### 2.2 Is the migration destructive?

Examples: a dropped or renamed column, a `NOT NULL` added to a column with existing NULLs (requires a backfill first), a backfill that mutated existing row values, a changed column type that lost precision.

**If yes, in order of preference:**

1. **A hand-written down-migration**, if `node-pg-migrate`'s `down` function for that migration was written and is verified safe to run against the current (possibly already-mutated) data. Run it explicitly:
   ```bash
   gcloud run jobs execute goms-migrate --project=goms-prod --region=asia-south1 \
     --args=node,node_modules/node-pg-migrate/bin/node-pg-migrate.js,down
   ```
   (`node-pg-migrate down` reverts exactly one migration per invocation by default — confirm the target before running, since running it twice reverts two.)
2. **Cloud SQL point-in-time recovery (PITR)**, if no safe down-migration exists. PITR is already enabled (`infra/prod/database.tf`: `point_in_time_recovery_enabled = true`, matching dev) and restores the entire database to a specific moment before the bad migration ran.

   **This is a heavy, data-loss-risking operation, not a routine step:**
   - Everything written to the database *after* the restore point is lost — every row inserted/updated by real users during the incident window, not just the bad migration's own effects.
   - It typically restores into a *new* Cloud SQL instance (per Cloud SQL's PITR model), which then needs to be promoted/pointed-to in place of the original — an operational sequence of its own, not a single command.
   - **This must be a deliberate, explicit decision by whoever's on call, made after weighing the data-loss window against the cost of staying broken** — never triggered automatically, and never triggered without first confirming §2.1 doesn't apply (i.e., confirming the migration really was destructive, not just assumed to be).

### 2.3 Decision tree, summarized

```
Incident traced to a recent deploy
        │
        ▼
Roll back the Cloud Run revision (§1) — always do this first, it's instant and safe
        │
        ▼
Did that deploy also include a migration?
   │                              │
   No                            Yes
   │                              │
Done.                    Was the migration additive/backward-compatible? (§2.1)
                                   │                              │
                                  Yes                             No
                                   │                              │
                            No further action.        Safe down-migration exists? (§2.2)
                                                              │                    │
                                                             Yes                   No
                                                              │                    │
                                                    Run `node-pg-migrate down`   PITR restore —
                                                    for that migration only.     deliberate, explicit,
                                                                                 last resort (§2.2)
```

---

## 3. Post-rollback verification — confirm the fix actually landed

Don't close out an incident on "the rollback command returned success" alone — Cloud Run accepting a traffic-shift request is not the same as the service being healthy afterward.

1. **Uptime check turns green.** If Stage B's monitoring (`infra/prod/monitoring.tf`) is applied, `goms_api_down`'s alert should clear on its own within ~2 minutes (its own 2-consecutive-failure/60s-period threshold) — watch for that rather than assuming silence means health. If monitoring isn't applied yet, hit the health endpoint directly:
   ```bash
   curl -sf https://<goms-prod-hostname>/api/trpc/health.check
   ```
   Expect `{"result":{"data":{"ok":true,"db":"connected"}}}` — this already round-trips a real `SELECT 1` (§0 of the Stage B plan), so a healthy response here also confirms Postgres connectivity, not just that the container started.
2. **Confirm traffic actually moved**, not just that the command accepted:
   ```bash
   gcloud run services describe goms-api --project=goms-prod --region=asia-south1 \
     --format="value(status.traffic)"
   ```
   The rolled-back revision should show 100% — if another revision still shows nonzero traffic, the shift didn't fully take (e.g. a typo'd revision name) and needs to be reissued.
3. **Smoke-test at least one write path**, not just reads — a revision can serve `health.check` fine while still failing on a specific mutation (e.g. if the rollback also crosses a schema boundary §2 didn't catch). Pick one low-risk, easily-reversible mutation exercised in the Stage B plan's full remote-mode regression (e.g. creating and immediately deleting a test follow-up) rather than assuming read-only health implies write health.
4. **If a migration action was taken in §2** (down-migration or PITR restore), re-run `health.check` and the write-path smoke test *again* after that action completes, separately from the app-rollback verification above — a successful app rollback can still be followed by a schema action that itself introduces a new problem.
5. **Record what happened** — which revision was rolled back to, whether a migration action was needed and which one, and the timestamps of each step. This is what the next incident's §0 pre-deploy checklist and this runbook itself should be revised against; a rollback that reveals a gap in this document (a missing IAM role, a command that didn't work as written) should turn into an edit here, not just a one-off workaround.

---

## 4. IAM required to execute this runbook

- **`roles/run.admin`** on the `goms-prod` project — covers both §1 (`update-traffic`) and running the `goms-migrate` job (§2.1's down-migration path) via `gcloud run jobs execute`.
- **PITR restore** (§2.2) additionally needs `roles/cloudsql.admin` (or a custom role with `cloudsql.instances.restoreBackup`/equivalent) — a broader, more sensitive permission, appropriately gated separately from routine `run.admin` access.

Neither role is granted to any human by this document — provisioning real operator access is part of the still-open "who has access to goms-prod" question, tracked in the Stage B plan §7 checklist, not resolved here.
