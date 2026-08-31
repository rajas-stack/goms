# GOMS Local vs GCP Functional Parity Audit

**Date:** 2026-08-31 (re-verified same day, second pass — see "Re-verification" below)
**Status:** Audit only. No code changed as part of this document. **One caveat to flag up front:**
during the first pass, the 4 missing `preSales` master rows were written to `goms-prod` (with
explicit approval at the time) to close a missing-reference-data gap — see §3. Every check in the
second pass below was strictly read-only.
**Method:** For every workflow area, the actual local business-logic source (`src/data/in-memory/repository.ts`,
`src/modules/commercial-calculator/*`, `packages/domain/*`) was read and compared line-by-line
against the corresponding `apps/api/src/routers/*.ts` server implementation and its test suite.
Where a rule could be safely exercised, it was live-tested against the hosted production API via
a real `@trpc/client` (the same client the hosted frontend uses) — every test write was created,
verified, and deleted again, leaving zero residue (confirmed via `git status` and follow-up
queries after each pass). Nothing was assumed from a page simply rendering.

---

## Headline finding: most parity is real, not incidental

Three separate architecture facts make most of this audit come back "identical" rather than
"similar":

1. **`src/data/remote/repository.ts` fully implements the `Repository` interface.** Its own header
   comment claims `implements Partial<Repository>... nothing routes through this today` — that
   comment is stale. All ~114 methods of `Repository` are wired to a real tRPC call. There is no
   "the button does nothing in hosted mode" class of gap anywhere in this app.
2. **BOQ/SKU/master business logic is shared code, not parallel implementations.** Both
   `src/modules/commercial-calculator/repository-logic.ts` (local) and
   `apps/api/src/routers/commercial.ts` (server) import their actual math and state machine
   (`BOQ_TRANSITIONS`, `resolveApprovalBand`, `freshLineApprovalState`, `computeLineTotal`,
   `validateLineDiscountPct`, `SKU_SENSITIVE_FIELDS`, etc.) from **one** shared package,
   `packages/domain/src/commercial.ts`.
3. **Ownership inheritance and search are also shared code.** `resolveOwner`/`resolveOwners`
   (server) and the local repository both call the identical `effectiveOwner`/`buildOwnerMap`
   from `packages/domain/src/ownership.ts`. Search (`performSearch`, `performRelatedRecords`,
   `relationshipAnalytics`) is the same story via `packages/domain/src/search.ts`.

Given this, genuine parity gaps only show up where a side has its **own**, non-shared
implementation — the in-memory repository's own hand-written methods, or the server's own extra
SQL-level checks. That's exactly where every finding below comes from.

---

## Re-verification (second pass, same day)

Before handing this over, the load-bearing facts below were re-checked live and read-only
(a throwaway `@trpc/client` script against `https://goms-prod.web.app/api/trpc`, deleted after
use — no writes):

| Claim | Re-checked | Result |
|---|---|---|
| 4 `preSales` rows still on `goms-prod` | `commercial.masters.list({key:'preSales'})` | **4 rows present**: `PS-ARJUN`, `PS01`, `PS-KAVYA`, `PS02` — unchanged since the write |
| Vacant-seat gap still open, untouched | `employees.listAll` | **2 active employees**, 0 with a blank name — gap is exactly as documented, nothing modified |
| Central Ministries (`stateCode 0`) — flagged in your prior audit as a dead link (`docs/superpowers/analysis/2026-08-19-goms-functional-acceptance-test-catalogue.md`, back on the old Supabase backend) | `hierarchy.listStates` | **Fixed since that audit, and confirmed identical on both sides today.** `code: 0` state node exists on `goms-prod` — `{name: 'Central Ministries (Govt. of India)', departments: 6, offices: 26, employees: 2}` — out of **37** total state-type nodes (36 real states/UTs + the virtual Central Ministries entry). It's a fully first-class geo node now (`src/data/gov-hierarchy.ts`'s `CENTRAL_STATE_CODE = 0`, seeded by both `src/data/seed.ts` and the server's `geography` import domain), not a special-cased dead link — same code path as every other state on both sides. |

Also reviewed while re-verifying (reading code, not re-tested live — no server-side behavior to
diverge since it's the same schema on both sides):
- `apps/api/src/routers/employees.ts:276` (`employees.create`) and
  `apps/api/src/import/domains/employees.ts:20` (Admin Data Import `employeeRowSchema`) both do
  `name: z.string().min(1, 'Name is required')` with no `vacant`-flag exception — confirms finding
  #4 below is exact, current, and is the sole reason the 10 vacant seats can't be loaded server-side
  today, not an import-wizard limitation.

One additional **intentional, expected difference** surfaced that wasn't itemized in the original
pass: `TopBar.tsx` shows an amber **"Connected to goms-prod"** badge (with a tooltip naming the
live API base URL) whenever `VITE_API_BASE_URL` is set — i.e. always in production, never in local
dev. This is deliberate (`src/lib/api-environment.ts`, `resolveApiEnvironment`) and replaces a real
prior bug (BUG-001, a hardcoded "Connected to goms-dev" label that once shipped to production
regardless of actual target) with a label *derived* from the configured URL. Correctly
non-goal-seeking today: verified it reads `goms-prod` from the Firebase Hosting origin, not a
guess.

---

## 1. ✅ Functionality already identical (verified, not assumed)

| Area | Rule | Verified how |
|---|---|---|
| BOQ | Auto-approval discount banding (AM1–AM4, "stricter band wins on tie") | Live: 5% → auto-approved; exactly 10% (boundary) → pending, both sides |
| BOQ | `BOQ_TRANSITIONS` state machine, incl. "can't approve with a pending line" | Live: exact same rejection message text on both invalid transitions tested |
| BOQ | `reviseBoq` (same `boqNumber`, `boqVersion`+1, `parentBoqId` set) vs `duplicateBoq` (fresh number, version 1, no parent) | Live: both exercised on the same source BOQ, fields matched local doc contract exactly |
| BOQ | `changeReason` required for a `features` master's `status` change | Live: identical rejection message |
| BOQ | Delete-blocked-by-reference for SKUs/masters referenced by a BOQ | Live: identical rejection message |
| BOQ | Line-item price/tax/margin recalculation, BOQ grand-total update | Live: formula-verified exactly (`2 × (120000×0.95) × 1.18 = 269040`, etc.) |
| BOQ | `reorderBoqLineItems` | Live: reversed order persisted correctly |
| Hierarchy | Duplicate branch-name prevention (case/whitespace-insensitive, returns existing node) | Live: identical id returned twice |
| Hierarchy | `duplicateNode` subtree-copy semantics (root gets " (Copy)", children copied as-is) | Live: matched exactly |
| Hierarchy | `moveNode` "can't move into own subtree" rejection, incl. error text | Live: identical message |
| Hierarchy | `reorderNode` splice-and-renumber | Live: matched |
| Geography | Drill-down counts (36 states, 736 districts, correct taluka linkage) | Live: `childCounts` summed to exactly 736 |
| Geography | Central Ministries virtual state (`stateCode 0`) — previously a dead link on the old Supabase backend (2026-08-19 audit) | Live: `hierarchy.listStates` returns 37 states incl. `code:0` with 6 departments/26 offices/2 employees on `goms-prod`; same seed/import path as every real state on both sides |
| Employees | `mergeEmployees` full reassignment (timeline, transfers, charges, direct reports, dept headship, field unions) | Live: exact match on a 3-employee merge scenario |
| Employees | `transferEmployee` (org node change + transfer history) | Live: matched |
| Employees | `setManager`/`directReports`/`reportingChain` (self-report/cycle rejection) | Live: matched |
| Employees | Timeline events, charges | Live: matched |
| Sales | `transferSalesPerson` (closes old posting, `changeType` derivation via tier rank) | Live: matched, incl. `promotion` classification |
| Opportunities | Stage-change history ordering (`changedAt`, monotonic tiebreak) | Live: matched |
| Follow-ups | Open/done status transitions | Live: matched |
| Ownership | `assignOwner` auto-closes incumbent, rejects bad `startDate` | Live: matched |
| Ownership | `resolveOwner` ancestor-inheritance walk | Live: matched (shared code, confirmed) |
| Ownership | `transferBookOfBusiness` — no entity-type filter, moves org nodes AND opportunities | Live: matched on both entity types |
| Search | Coverage (7 categories), ranking, `stateCode` scoping | Shared code; live queries returned sane, correctly-scoped results |
| Reference data | verticals, products, modules, features, skuCategories, unitsOfMeasure, productEditions, billingTypes, taxClasses, approvalMatrix, currencies, SKUs, BOM, all 36 states | Row-count match, local seed vs hosted, every key |

---

## 1b. ⚠️ Expected / intentional differences

These are deliberate, by-design differences — not bugs, and not things to "fix" for parity:

| Area | Local behavior | Production behavior | Why it's intentional |
|---|---|---|---|
| TopBar | No environment badge shown | Amber "Connected to goms-prod" badge, tooltip shows full API base URL | `VITE_API_BASE_URL` is unset locally, set in the hosted build — `resolveApiEnvironment` (`src/lib/api-environment.ts`) derives the badge only when a remote backend is configured. Replaces a real prior bug (hardcoded "goms-dev" label, BUG-001). |
| Settings → Backup/Restore | Visible (IndexedDB backup/restore) | Hidden | Remote mode has no local IndexedDB to back up; server owns its own DB backups (`src/features/settings/SettingsDialog.tsx`). |
| Admin Data Import (`/admin/data-import`) | Client route exists but has no working backend to call (no `VITE_API_BASE_URL` at all in default local dev) | Client route exists; server 404s every `adminImport.*` call because `ADMIN_IMPORT_ENABLED` is unset on `goms-prod` (`apps/api/src/trpc.ts:34`) | Deliberately gated off in production per `docs/superpowers/plans/2026-08-27-goms-prod-admin-import-enablement-plan.md` — this is an internal ops tool with no link from any normal navigation path, not a user-facing feature, so it doesn't affect the checklist areas you asked about. |
| Persistence location | IndexedDB / in-memory | Cloud SQL via the GCP API | The one difference you explicitly scoped as expected. |

---

## 2. Functionality that differs (real findings) — ❌ genuine discrepancies

| # | Where | Local behavior | Hosted (server) behavior | Which is "correct" per your source-of-truth rule |
|---|---|---|---|---|
| 1 | `deleteMasterLogic` (masters delete) | Only blocks delete if referenced within the verticals→products→modules→features hierarchy. Deleting a `taxClasses`/`currencies`/`skuCategories`/`unitsOfMeasure`/`productEditions`/`billingTypes` row still referenced by a live SKU **succeeds silently**, leaving that SKU's foreign key dangling. | Additionally blocks delete when referenced by a SKU column, or (for `verticals`/`currencies`) by a BOQ. Live-verified: deleting a tax class referenced by 8 SKUs was correctly rejected. | **Local under-enforces.** To reach parity, local's in-memory `deleteMasterLogic` needs the same SKU/BOQ cross-reference checks the server has. |
| 2 | `createSalesPerson` | No uniqueness check on `officialEmail` at all — two sales persons can share an email. | Rejects a duplicate `officialEmail` with `CONFLICT`. Live-verified. | **Local under-enforces.** Needs the same duplicate-email check added locally. |
| 3 | `importChildren` (bulk hierarchy CSV import) | Increments its reported `added` count for every non-blank row, **even rows that get deduped** against an existing branch name — inflates the toast's reported count. | Explicitly tracks `existingBranchNames` and excludes dupes from the count (its own test asserts this). | **Local reports the wrong count** (final tree state ends up identical either way — this is a cosmetic/reporting bug, not a data bug). |
| 4 | `employees.create` (server, both regular create AND the Admin Data Import `employeeRowSchema`) | Local's demo data — and by extension local's `createEmployee` — permits a blank `name` for a vacant government seat (`vacant: true`). | **Every server-side employee-creation path requires `name.min(1)`** — confirmed on both the regular `employees.create` procedure's zod schema and the Admin Data Import schema. There is currently no way to create a vacant, nameless employee record against the hosted API at all. | **This is the actual root cause of the 10 missing vacant seats** (see §3) — not just an import-wizard gap, a genuine schema mismatch between local and server. |
| 5 | `docs/superpowers/analysis/2026-08-27-goms-prod-temporary-drift-register.md`, DRIFT-002 | — | — | **Fixed 2026-08-31.** Corrected the register's "expect 404s" claim — live-verified the actual response is `HTTP 200` serving the SPA's `index.html` shell (Firebase Hosting's catch-all rewrite), which then fails `res.json()` parsing and is caught by `loadVillageShapes()`'s own `try/catch` (not its `!res.ok` branch, as originally described). End-user behavior was always correct (graceful fallback to the flat village list) — only the stated evidence was wrong; now corrected in-file with the precise mechanism. |
| 6 | Geography node count | Local `buildSeed()` produces 7,179 `domain:'geo'` nodes. | 7,178 committed to production. | 1-row difference, does not affect the 36-states/736-districts headline figures. Likely a synthetic local-only root node. Not investigated further — flagging for completeness, not urgent. |
| 7 | `src/data/remote/repository.ts` header comment | — | — | **Fixed 2026-08-31.** Corrected the stale "Implements `Partial<Repository>`... nothing routes through this today" comment — it now states plainly that every method is implemented and is exactly what `goms-prod` routes through, with a pointer to this audit as the evidence. |

Everything else checked (concurrency locking added server-side for `createNode`, `moveNode`,
`setManager`, `assignOwner`; a Postgres FK constraint on `hierarchy_nodes.parent_id` that doesn't
exist as an in-memory equivalent) is the server being **additionally safe** under concurrent
access that a single-threaded local session can't produce — not a behavioral difference a user
would ever observe.

---

## 3. ⚠️/❌ Missing data

| What | Local count | Hosted count | Root cause | Status |
|---|---|---|---|---|
| `preSales` commercial master | 4 rows | ~~0~~ **4** | No Admin Data Import domain exists for this one of 12 master keys — the bulk-load script explicitly skipped it. | **Fixed 2026-08-31.** All 4 rows (`PS-ARJUN`, `PS-KAVYA`, `PS01`, `PS02`) written via `commercial.masters.create` (the ordinary, ungated masters CRUD procedure — `ADMIN_IMPORT_ENABLED` was never touched) and verified present with matching code/name/description/active/displayOrder. Two of the four (`PS01`/`PS02`) are literally hardcoded in `src/data/seed.ts` as `"QA fixture pre-sales executive"` rows, not real demo business content — flagged before writing, approved, kept for consistency with the "QA Test" department/employees already loaded from the same `buildSeed()` source. |
| 10 vacant government-seat employees | 12 employees (2 real + 10 vacant) | 2 | The demo data models a vacant seat as an employee row with a blank `name` (deliberate — "nobody holds this position"). **Every** server-side employee-creation path (`employees.create`, and the Admin Data Import `employeeRowSchema`) requires a non-blank name — see finding #4 above. | **Still open — deliberately not touched.** Requires a schema/validation decision (relax name requirement for `vacant:true`, or accept as a permanent scoped difference) explicitly out of scope for this pass. |

Both gaps were already known/flagged (in `scripts/prod-reference-import.ts`'s own warnings and the
drift register) — this audit did not find any *additional* missing reference data beyond these
two. Every other master key, all SKUs, the one BOM item, all 36 states, and 736 districts match
local exactly.

---

## 4. Local-storage fallbacks

**None found.** Specifically checked and confirmed:
- `bootstrapRepository()`/IndexedDB hydration is skipped entirely whenever `VITE_API_BASE_URL` is
  set (verified in code, `src/main.tsx`).
- Settings → Backup/Restore is hidden in remote mode (`src/features/settings/SettingsDialog.tsx`),
  so there is no UI path that could silently read/write local IndexedDB state instead of the
  server.
- No other `Repository` method or UI screen was found reading from `src/data/in-memory/*` while
  in remote mode — the top-level `repository` export in `src/data/repository.ts` is a single
  ternary on `VITE_API_BASE_URL`, and every screen goes through that one export.

---

## 5. Bugs / blockers

None of the following block the app from being usable — they're the concrete gaps this audit
exists to surface:

1. **(Blocker for full data parity)** No employee-creation path anywhere on the server accepts a
   blank name — blocks loading the 10 vacant seats without a schema change.
2. **(Real bug, local under-enforcing)** Local in-memory `deleteMasterLogic` allows deleting a
   still-referenced tax class/currency/UOM/edition/billing-type/SKU-category, leaving a dangling
   foreign key in local mode only.
3. **(Real bug, local under-enforcing)** Local `createSalesPerson` allows duplicate
   `officialEmail`s; hosted correctly rejects them.
4. **(Cosmetic, local over-reporting)** Local `importChildren`'s toast overcounts imported rows
   when the CSV contains duplicate branch names.
5. ~~(Documentation only) DRIFT-002's "expect 404s" description is factually wrong~~ **Fixed
   2026-08-31.**
6. ~~(Documentation only) `src/data/remote/repository.ts`'s header comment is stale~~ **Fixed
   2026-08-31.**

---

## 6. Exact changes required to achieve full parity

In priority order (data gaps first, since those are user-visible right now; code-parity items
next; docs last):

1. ~~Load the 4 `preSales` master rows into `goms-prod`~~ **Done 2026-08-31** — written via
   `commercial.masters.create`, verified present, verticals/currencies counts unaffected,
   `ADMIN_IMPORT_ENABLED` confirmed still off throughout.
2. **Decide how to handle the 10 vacant seats**, since it requires an actual schema/code decision:
   - Option A: relax `employeeRowSchema` (Admin Data Import) and the regular `employees.create`
     procedure's `name` validation to allow blank when `vacant: true` — then re-run the import for
     just those 10 rows.
   - Option B: leave vacant seats unrepresented in production going forward (accept this as a
     scoped, permanent difference — arguably reasonable, since "vacant" seats convey no real
     information beyond "this org position has nobody in it," which the org hierarchy node itself
     already communicates).
   - This is a product decision, not a mechanical fix — flagging for your call, not proposing to
     silently pick one.
3. **Add the missing cross-reference checks to local's `deleteMasterLogic`** (in
   `src/modules/commercial-calculator/repository-logic.ts`) so local matches the server's stricter,
   correct behavior — a straightforward code change, no data implications.
4. **Add a duplicate-`officialEmail` check to local's `createSalesPerson`** to match the server's
   `CONFLICT` behavior.
5. **Fix local's `importChildren` to exclude deduped rows from its reported count**, matching the
   server's `existingBranchNames`-excluded count.
6. **Correct DRIFT-002's evidence description** in the temporary drift register (200-serving-SPA-shell,
   not 404) — documentation-only, no behavior change.
7. **Correct `src/data/remote/repository.ts`'s stale header comment** to reflect that it's a
   complete implementation actively used in production — documentation-only.

Items 3–7 are pure code/doc fixes with no data-loss risk and could be done in one pass whenever
you'd like; items 1–2 involve production data and should go through the same
show-before-you-write approval this session has been using.

---

## What was not (and could not safely be) live-tested

- SKU cost/price `changeReason` enforcement on a real seeded SKU (avoided mutating production
  pricing data) — confirmed identical by reading the shared `SKU_SENSITIVE_FIELDS` list instead.
- BOM cost-rollup margin math end-to-end on production's one real BOM item — the formula is
  shared code (`packages/domain/src/commercial.ts`), so there is no server-side reimplementation
  that could diverge.
- Cross-currency BOQ pricing (all 9 production SKUs are INR-denominated today, so no live
  multi-currency BOQ could be constructed against current catalog data).
- Genuine concurrent-request races (advisory locks, `SELECT ... FOR UPDATE`, the DB partial unique
  index on ownership) — these are additive server-side safety, confirmed by reading the schema/
  migrations and tests rather than by inducing a real race against production.
