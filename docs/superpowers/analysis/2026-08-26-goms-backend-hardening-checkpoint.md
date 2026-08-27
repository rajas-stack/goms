# Backend Hardening Checkpoint — 2026-08-26

**Scope:** Backend quality/hardening pass on `apps/api`, independent of authentication and production infrastructure — transaction boundaries and concurrency, DB constraints/FKs/uniqueness, input validation and destructive-operation safeguards, query/index/performance, large-batch/concurrent-request behavior, error handling, and migration quality. Every fix below was found through code review (three parallel audits covering migrations, transaction/concurrency safety, and N+1/in-memory-parity), backed by evidence (file:line), and has a regression test. Nothing here touches authentication, `.gitlab-ci.yml`, `goms-prod`, `VITE_API_BASE_URL`'s default, or introduces new GCP infrastructure.

---

## 1. Issues found and fixed

### Data-integrity races (the highest-severity findings)

1. **`commercial.boq.delete` — unlocked TOCTOU, no re-check at delete time.** Read status, then unconditionally `DELETE` with no row lock and no status re-check in the `WHERE` clause — a concurrent `updateStatus` moving the BOQ out of the deletable set between the read and the delete could still let it through. **Fix:** wrapped in a transaction, locks the row `FOR UPDATE`, re-checks status inside the lock (`commercial.ts`).
2. **`ownership.assign` — "empty openOwners" race.** The `FOR UPDATE` lock only locks *existing* open-owner rows; for an entity's first-ever assignment there's nothing to lock, so two concurrent first-assigns could both pass and both insert, leaving two simultaneously "open" owners. **Fix:** new migration adds `ownership_assignments_one_open_owner_per_entity`, a partial unique index mirroring the already-proven `one_current_sales_posting_per_person` pattern on `sales_postings`; `assign` now catches the resulting violation and returns a friendly `CONFLICT` (`apps/api/migrations/1787660000000_ownership-one-open-owner.sql`, `ownership.ts`).
3. **`employees.setManager` — cycle-detection TOCTOU.** Two concurrent calls (A: set X's manager to Y; B: set Y's manager to X) could each pass the recursive-CTE cycle check before the other committed, producing a real 2-node reporting cycle. **Fix:** wrapped in a transaction, locks both employee rows in a stable (sorted) id order before the cycle check (`employees.ts`).
4. **`hierarchy.moveNode` — the same cycle-TOCTOU, for the tree.** Two concurrent swap-moves could each pass the "not my own subtree" check before the other committed. **Fix:** same pattern — locks both the moved node and its prospective new parent, sorted, before the subtree check (`hierarchy.ts`).
5. **`hierarchy.createNode`'s branch-name dedup — unprotected check-then-insert.** No unique index (deliberately — branch names aren't unique across other `type_key`s), no lock. **Fix:** a Postgres advisory lock (`pg_advisory_xact_lock(hashtext(...))`) keyed on the exact `(parentId, 'branch', name)` tuple serializes concurrent creates for that one dedup key without a schema change (`hierarchy.ts`).
6. **`recomputeBoqGrandTotal`'s lost-update race.** `updateLineItem`/`removeLineItem` computed a `SUM()` then wrote `grand_total` without holding the BOQ row's lock for the duration — two concurrent edits to two different lines on the same BOQ could each compute their sum before seeing the other's committed change, and whichever wrote last silently discarded the other's contribution to the total. **Fix:** both now lock the BOQ row `FOR UPDATE` before recomputing (`addLineItem` already did, incidentally); `commercial.ts`.

### Unhandled/raw errors surfacing instead of friendly messages

7. **`commercial.masters.create`/`update`, `commercial.skus.create` — raw `23505` unique-violation.** The app-level pre-check (a plain `SELECT`) isn't atomic with the `INSERT`; the real unique index still stops a concurrent duplicate, but the loser previously got an unhandled Postgres error instead of the same `CONFLICT` the pre-check produces for the non-concurrent case. **Fix:** new shared `isUniqueViolation` guard (`apps/api/src/db-errors.ts`), caught and translated in all three mutations.
8. **`commercial.masters.delete` — no cross-table reference check.** Only checked the self-referencing `parent_id` hierarchy (verticals → products → modules → features); never checked whether a `commercial_skus` row (7 FK columns, `RESTRICT`) or a `commercial_boqs` row (`vertical_id`, `RESTRICT`) still referenced the master being deleted — unlike `skus.delete`, which already does the equivalent check for BOM/BOQ-line-item references. **Fix:** added the same style of pre-check (SKU columns via a lookup table, `verticals`→BOQ, and — since `commercial_boqs.currency` is deliberately plain `TEXT`, not an FK, with **no DB backstop at all** — a dedicated code-match check for `currencies`), each with a friendly `CONFLICT` (`commercial.ts`).
9. **`hierarchy.deleteNode`, `sales.delete` — unhandled `23503`.** `transfers.to_org_node_id` and `commercial_boqs.department_id`/`.sales_person_id` are all `RESTRICT`, but neither mutation pre-checked or caught the resulting violation. **Fix:** both now catch it via the shared `isForeignKeyViolation` guard and return a friendly `CONFLICT` (`hierarchy.ts`, `sales.ts`).

### Missing dedup / behavioral parity

10. **`hierarchy.importChildren` bypassed `createNode`'s branch-name dedup rule entirely** (it inserts directly instead of calling `createNode`), so a bulk import containing a name that duplicated an existing (or an earlier-in-the-same-batch) active branch silently created a genuine duplicate node — a real Postgres-vs-in-memory behavioral divergence (in-memory's `importChildren` delegates to `createNode`, which does dedup). **Fix:** `importChildren` now applies the identical dedup rule, including within the same import batch (`hierarchy.ts`).
11. **In-memory `deleteEmployee` bug: the manager-fallback lookup ran *after* the employee was already filtered out of the array**, so it always resolved to `undefined` and every direct report's `managerId` was unconditionally set to `null` — contradicting the function's own "falls back to the removed person's manager" comment, and diverging from the Postgres router's (correct) behavior of reading `manager_id` before deleting. **Fix:** look up the removed employee before filtering (`src/data/in-memory/repository.ts`).
12. **`employees.delete` (Postgres) left a dangling `deptHead` pointer** in `hierarchy_nodes.metadata` when the deleted employee headed a department — `merge` already has the equivalent cleanup (reassigning the pointer to the survivor); plain `delete` had none. **Fix:** clears the key outright on delete, mirrored into the in-memory implementation for parity (`employees.ts`, `src/data/in-memory/repository.ts`).

### Performance

13. **`commercial.boq.list` — N+1 across every draft BOQ.** Fetched each draft BOQ's line items with its own `SELECT ... WHERE boq_id=$1` inside a `Promise.all` over the whole list — 1 + N round trips just for line items, on every load of this list. **Fix:** batch-fetches every draft BOQ's line items in one `WHERE boq_id = ANY($1)` query, grouped by `boq_id` in application code, and passed into an extended `withLiveDraftGrandTotal(client, boq, preFetchedLines?)` (`commercial.ts`).
14. **`hierarchy.importChildren` re-queried `siblingCount` from the DB on every loop iteration**, even though the loop itself was the one incrementing it. **Fix:** read once upfront, tracked locally; combined with a single multi-row `INSERT` instead of one per row (same edit as #10, `hierarchy.ts`).
15. **Unbounded/under-configured `pg.Pool`.** No `max`/`connectionTimeoutMillis` — `pg`'s default (`max: 10`, no connection timeout) leaves headroom mismatched against Cloud Run's own default concurrency (80 req/instance) and `db-f1-micro`'s low connection ceiling; a saturated pool would hang requests indefinitely rather than failing fast. **Fix:** explicit `max: 8`, `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000` (`db.ts`) — sized to leave headroom under Cloud SQL's ceiling across several concurrently-scaled instances.

---

## 2. Tests added

38 new regression tests across 8 apps/api test files plus 1 new frontend test file (all passing, verified stable across two consecutive full runs to rule out flakiness in the concurrency-based tests):

| File | New tests |
|---|---|
| `apps/api/src/routers/commercial.test.ts` | Concurrent create-same-code race → exactly one `CONFLICT`, no raw error, no duplicate row; masters.delete blocked by a SKU reference |
| `apps/api/src/routers/commercial-skus.test.ts` | Concurrent create-same-generated-code race → friendly `CONFLICT` |
| `apps/api/src/routers/commercial-boq.test.ts` | `boq.delete` vs. concurrent `updateStatus` invariant (never both succeed, whichever loses gets the correct error); no lost update in `recomputeBoqGrandTotal` under concurrent line edits; `boq.list`'s batched fetch groups lines correctly per BOQ; `masters.delete` blocked by a BOQ's `vertical_id`; `masters.delete` blocked by a BOQ's `currency` (the no-FK case) |
| `apps/api/src/routers/hierarchy.test.ts` | Concurrent same-branch-name create never produces two nodes; concurrent swap-move never produces a cycle; `deleteNode` friendly `CONFLICT` on a `transfers.to_org_node_id` reference; `importChildren` respects dedup including within one batch |
| `apps/api/src/routers/employees.test.ts` | Concurrent `setManager` swap never produces a cycle; `delete` clears a dangling `deptHead` pointer |
| `apps/api/src/routers/ownership.test.ts` | Concurrent first-ever `assign` race → exactly one open owner survives, friendly `CONFLICT` |
| `apps/api/src/routers/sales.test.ts` | `delete` friendly `CONFLICT` when a BOQ still references the sales person |
| `src/data/in-memory/employees.test.ts` (new file) | `deleteEmployee`'s manager-fallback bug; `deleteEmployee`'s `deptHead` cleanup |

Six existing test files' `beforeEach` cleanup also needed extending (`employees.test.ts`, `follow-ups.test.ts`, `opportunities.test.ts`, `ownership.test.ts`, `sales.test.ts`, `search.test.ts`) — adding a new BOQ-referencing test in `sales.test.ts` meant `commercial_boqs`/`commercial_boq_line_items` now need clearing before `hierarchy_nodes` in every file that also clears `hierarchy_nodes`, matching the existing established cross-file-leftover-defense convention already used throughout this suite.

---

## 3. Performance/integrity checks performed

- **Full apps/api suite run twice consecutively** against a fresh temporary Postgres (`postgres:16`, torn down after) — 165/165 both times, including every concurrency-based test, to rule out race-condition flakiness in the new tests themselves.
- **Root unit suite** (`npm test`): 249/249, including the 2 new in-memory-repository tests.
- **Component suite** (`npm run test:component`): 132/132, unaffected.
- **`apps/api`'s own build** (`tsc -p tsconfig.json`): clean.
- **Root `tsc -b`**: clean.
- **Production build** (`npm run build`): clean, ~1m42s.
- **New migration applied cleanly** against a fresh database (`npm --workspace apps/api run migrate up`), confirming `ownership_assignments_one_open_owner_per_entity` is valid DDL with no syntax/dependency issues.
- **N+1 audit**: full inventory taken across all 10 routers (see the parallel audit's Part 1) — the worst instance (`boq.list`) is fixed; the rest are catalogued and prioritized below (§4).
- **Migration audit**: all 9 migrations (8 pre-existing + 1 new) confirmed purely additive — no `DROP COLUMN`/`RENAME`/unsafe `NOT NULL` anywhere, every down-migration a clean reverse-order `DROP TABLE`. Full FK/uniqueness/index inventory taken (see the parallel audit) and cross-checked against what's actually queried in `apps/api/src/routers` to separate "real gap" from "theoretical gap, never queried this way."

---

## 4. Intentionally deferred

Found and evaluated, but not fixed in this pass — with the specific reason for each:

- **`withLiveDraftPricing`'s own N+1 inside `boq.list`.** Even after batching the line-items fetch (§1.13), each draft BOQ still triggers its own SKU/tax/currency lookup queries inside `withLiveDraftPricing`. Fully batching this too would mean restructuring that function's per-BOQ signature into a cross-BOQ batch API — a larger refactor of shared pricing logic (also used by `boq.get`/`listLineItems`) than this pass takes on. The fixed piece (§1.13) was the single largest contributor (the audit's own "worst finding" framing was about the *line-items* fetch specifically).
- **Smaller N+1s catalogued but not fixed**: `hierarchy.listStates` (2 extra queries per state), `hierarchy.childCounts` (1 per child), `hierarchy.fetchBreadcrumb`/`employees.reportingChain` (sequential per-ancestor walk — a recursive CTE would collapse each to one query, the same pattern `employees.ts`'s own cycle-detection query already uses two functions away), `employees.import` (2 queries per imported row), `employees.create`'s per-charge insert loop, `commercial.ts`'s `setEditionFeatures`/`reorderLineItems` per-row loops, `commercial.ts`'s `skuFkChecks`/`resolveFeatureHierarchy` (6 and 4 sequential lookups respectively), `ownership.transferBookOfBusiness` (2 queries per reassigned entity). None of these are hit on a page-load-critical hot path the way `boq.list` is (most are bounded by user-input-sized batches — a CSV import, a bulk reassignment — not by total row count in the table), so each is a real, scoped, independently-fixable follow-up rather than an urgent one.
- **`employees.code` uniqueness — no DB constraint, no app-level check.** Random 4-digit suffix, genuinely unguarded (confirmed by the migration audit), but adding a real unique index without first checking `goms-dev`'s existing data for collisions would be an unverified schema change — deferred rather than guessed at. A lighter, no-migration mitigation (an app-level `SELECT`-based availability check + regenerate-on-collision, matching the pattern already used for master codes/SKU codes) is a reasonable follow-up that doesn't require touching the schema.
- **Validation-order differences (in-memory vs. Postgres) in `ownership.assign`/`transferBookOfBusiness`** — which of two simultaneously-invalid conditions surfaces first differs between the two backends. Doesn't change what's ultimately accepted/rejected, only which error message a caller sees first when multiple things are wrong at once — low-severity, not fixed.
- **SKU FK validation gap (Postgres stricter than in-memory)**: Postgres's `skus.create`/`update` validate all 7 FK fields against real master rows; in-memory only validates the feature→module→product→vertical chain, silently accepting a dangling `uomId`/`currencyId`/`taxClassId`/`billingTypeId`/`categoryId`. Not fixed in this pass — bringing in-memory up to parity here is a legitimate follow-up (Postgres is the more-correct side, so this would be tightening in-memory, not loosening Postgres) but was deprioritized in favor of the higher-severity concurrency/data-integrity fixes above.
- **Standard-edition resolution differs by design** (in-memory: fixed seed id; Postgres: looks up `code='STD'`) — already documented in-repo (`commercial.ts:328-339`'s own comment) as an intentional, accepted difference, not a gap.
- **Long-held-transaction observations** (`employees.merge`, `employees.transfer`, `hierarchy.duplicateNode`, `commercial.boq.revise`/`duplicate` each hold a connection through many sequential queries) — noted by the concurrency audit as a connection-pool-pressure concern, not a correctness bug. The `db.ts` pool-sizing fix (§1.15) addresses the failure mode (hanging instead of failing fast) without needing to restructure any of these individually-correct transactions.

---

## 5. What this pass did not touch

No authentication code, no `.gitlab-ci.yml` changes, no `goms-prod` provisioning, `VITE_API_BASE_URL` untouched (still unset by default), no new GCP infrastructure. Every fix lives in `apps/api/src` (plus one new additive migration) and, for the two in-memory-parity fixes, `src/data/in-memory/repository.ts`.
