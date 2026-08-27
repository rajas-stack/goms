# GOMS Production Data Strategy: Fresh Database vs. Data Migration

**Date:** 2026-08-26 (revised same day)
**Status:** **Decided — Option A's data scope stands; its loading mechanism is superseded.** The
*what* — a fresh `goms-prod` database holding only approved baseline/reference data, never a
`goms-dev` copy, never automatic browser-data migration, transactional data starts clean — is
unchanged and still the decision. The *how* changed: this is **no longer a developer-run seed
script**. See "Revised mechanism" immediately below. Full design:
`docs/superpowers/specs/2026-08-26-goms-admin-data-import-design.md`.

## Revised mechanism: self-service Admin Data Import, not a developer seed script

The original Option A (below) proposed a one-time `apps/api/scripts/prod-reference-seed.ts` run
by a developer against a user-supplied list. **That is explicitly no longer the plan.** The
requirement is that an authorized Amnex person loads `goms-prod`'s reference data themselves,
through the live website, with no Cloud Shell, SQL, Terraform, script, or developer involvement
of any kind.

This is now a real application feature — an admin-only Data Import module — not a migration
utility: domain-specific Excel/CSV templates (Geography, Organization Hierarchy, Employees,
Sales Roster & Postings, Commercial Masters ×2, Currencies, Tax Classes, Approval Matrix, SKUs,
BOM), each with a downloadable template, drag/drop upload, schema/required-field/duplicate/
reference validation, a preview before commit showing create/update/unchanged/reject per row, a
downloadable error report, and a transactional commit that never partially applies. Full
architecture, per-template column specs, dependency order, validation pipeline, and UI flow are
in `docs/superpowers/specs/2026-08-26-goms-admin-data-import-design.md` — not duplicated here.

**Nothing is implemented, provisioned, or migrated yet.** The spec above is design-only. The
sections below (the original Option A / Option B comparison) remain accurate for the *data
scope* question they answered — Option A's scope is still selected — but Option A's own
"what would need to happen" steps 3-4 (a developer-run seed script) are superseded by the spec
linked above and should be read as historical context for how this decision arrived, not as the
current plan.

## Decision (data scope — unchanged)

**Option A's data scope — fresh production database + approved reference data — remains the
selected starting scope**, unless a specific real-data migration requirement is identified later
(i.e., unless the user explicitly identifies real records that must be migrated, superseding this
decision for those specific records).

`goms-prod` starts empty except for admin-approved baseline/reference data needed for the
application to function:
- geographic and organizational hierarchy
- employees/sales roster
- commercial masters
- SKUs/BOM/reference configuration
- currencies/tax classes/approval matrix
- other explicitly approved reference data

Explicitly out of scope for the initial cutover:
- The entire `goms-dev` database is **not** copied into production.
- Arbitrary browser/IndexedDB data is **not** migrated automatically.
- Production transactional data starts clean — no hierarchy/employee/sales/customer/BOQ rows beyond the approved reference data, unless the user explicitly identifies real records that need to be migrated.

**How that data actually gets in is the Admin Data Import feature described above — not a fixed,
developer-prepared dataset, and not a script.**

---

## The fact this decision has to start from

**Before Stage A (2026-08-26's dev cutover), GOMS had no shared backend at all.** Every deployment ran fully client-side: `src/data/in-memory/repository.ts` holds an in-process `GormsData` object, seeded once per browser by `buildSeed()` (`src/data/seed.ts`) and persisted only to that browser's own IndexedDB (`bootstrapRepository()`/`getFullSnapshot()`/`restoreFromBackup()`). There was never a single source of truth — each user's browser held its own independent copy, and nothing synced between them.

This means the question "migrate the real existing GOMS data" doesn't have an obvious single answer the way it would for a system replacing an existing central database. **There is no existing central database.** What may exist instead, per person, is:
- Whatever a given user's browser currently holds in its local IndexedDB store (real hierarchy/employee/sales/commercial data they've been entering, if GOMS has been in real use pre-cutover).
- A local JSON export of that data, if anyone has ever used Settings → "Export full backup" (`src/features/settings/SettingsDialog.tsx`, `downloadBackup(getFullSnapshot())`) — this already produces a complete `GormsData` snapshot in a stable JSON shape, tested (`src/data/backup.test.ts`) and restorable (`restoreFromBackup`).
- Reference/master data that may have been curated by hand in one particular browser (Commercial Calculator's verticals, product editions, currencies, SKU categories, billing types, tax classes, approval matrix) — this is exactly the "genuinely rare, genuinely admin" data category the Stage B plan's §1.3 role model is built around, and is the most likely candidate for anything worth carrying into production, since it's configuration-like rather than per-user working data.
- Nothing at all, if GOMS has been used only for demos/evaluation so far and no one's browser holds data anyone would call "real."

Only the user can say which of these is true today. This document doesn't guess — it lays out what happens under each option so that whichever answer comes back, the mechanics are already worked out.

---

## Option A: Fresh production database + approved initial reference data — SELECTED (scope); loading mechanism superseded

**What it means:** `goms-prod`'s Cloud SQL instance starts genuinely empty (post-migration-DDL, pre-data) except for a small, explicitly-approved set of reference/master rows — the Commercial Calculator masters (verticals, product editions, currencies, SKU categories, billing types, tax classes, approval matrix, pre-sales), plus geography/organization hierarchy/employees/sales roster/SKUs/BOM per the fuller list in the "Decision" section above — approved by an authorized Amnex person, not invented by this process. Every hierarchy node, employee, sales record, customer, and BOQ starts from zero; real usage populates it going forward.

**What would need to happen:**
1. `infra/prod/*.tf` applied — Cloud SQL instance exists, empty.
2. `goms-migrate` Cloud Run Job run once — applies every schema migration, still zero data rows.
3. ~~The user supplies the approved reference-data list and a developer runs a one-time seed script (`apps/api/scripts/prod-reference-seed.ts`) against it.~~ **Superseded 2026-08-26.** Instead: the Admin Data Import feature (`docs/superpowers/specs/2026-08-26-goms-admin-data-import-design.md`) ships as part of the application itself, and an authorized Amnex person uploads each approved template through the live website once it's deployed — no developer, script, or database access involved at load time. `goms-seed-import` (dev's demo-data importer) stays dev-only regardless, unaffected by this change.
4. `goms-prod` is then genuinely ready — real usage starts writing hierarchy/employee/sales/customer/BOQ data from a clean slate.

**Trade-offs:**
- Simplest, lowest-risk option — no data-shape reconciliation, no risk of importing something wrong or stale.
- Loses whatever real work (if any) currently exists only in someone's local browser — anyone who's been using GOMS pre-cutover for real work would need to re-enter it, or export/import it manually via the existing Backup/Restore JSON format into their own account once auth exists (a per-user manual action, not a system migration).
- Right choice if pre-cutover usage has been demo/evaluation only, or if starting clean is acceptable even if some real data exists.

---

## Option B: Migrate/import real existing GOMS data — not selected

Recorded here for reference and left unscoped. Revisit only if the user explicitly identifies specific real records that need migrating — at which point that becomes a targeted, scoped exception on top of Option A rather than a wholesale switch to this option.

**What it means:** One or more browsers' current local `GormsData` (via the existing "Export full backup" JSON) is treated as the real starting dataset for `goms-prod`, imported wholesale (or merged, if multiple browsers each hold different real data — a harder sub-case, see below).

**What would need to happen:**
1. **The user identifies which browser(s)/person(s) hold data that should be treated as authoritative.** If it's more than one, the user also decides how conflicts are resolved (e.g. two different people's browsers both have a customer named the same but with different details) — this is a business judgment call the code cannot make.
2. Each identified source exports via Settings → "Export full backup" — already-built, already-tested, no new frontend work needed for the export side.
3. **A new import job is written** (does not exist today — this is real, unscoped work, distinct from both `goms-seed-import` and Option A's reference-seed script): parses one or more `GormsData` JSON exports and inserts them into `goms-prod`'s Postgres, in FK-safe order (hierarchy nodes → employees → sales roster/postings → ownership → customers → commercial masters → SKUs/BOM → BOQs/line items → audit logs — the same order the architecture doc §19.1 already specified for its own, different, assumption of importing `buildSeed()`'s demo data). This has to handle:
   - **ID collisions across multiple sources** (in-memory IDs are per-browser `uid()` strings — two browsers' data has no guarantee of non-overlapping IDs), if more than one source is merged.
   - **Referential integrity across the whole import** — an employee referencing an `orgNodeId` that must also be present in the import, etc.
   - **Validation/reconciliation** — row counts and spot-checks before `goms-prod` is considered ready, per architecture doc §19.1's own reconciliation step.
4. Run once, idempotently guarded the same way as any other one-time job (a marker row/table, so a re-run doesn't double-insert).

**Trade-offs:**
- Preserves real pre-cutover work instead of discarding it.
- Real, unscoped engineering work this document deliberately does not size — the FK-safe-order importer exists today only as a design sketch in the architecture doc for a *different* input (demo seed data, not real per-browser exports), and the multi-source merge case (if it applies) is genuinely new design work, not a mechanical adaptation.
- Only worth it if real data actually exists somewhere and is worth the engineering cost of a correct, validated import — which is exactly the fact only the user can supply (see below).

---

## What's still needed now

1. **The Admin Data Import feature has to be built.** Nothing in `docs/superpowers/specs/2026-08-26-goms-admin-data-import-design.md` is implemented yet — it's a design document, produced but not reviewed/approved for implementation as of this revision. Building it is now the actual path to loading `goms-prod`'s reference data, replacing the retired seed-script step.
2. **The reference data itself still isn't authored anywhere** — building the import feature doesn't invent what goes in the Geography/Organization Hierarchy/Employees/Sales Roster/Commercial Masters/Currencies/Tax Classes/Approval Matrix/SKUs/BOM templates. That's still an Amnex content decision, just now made *through the tool* (fill in and upload the template) rather than handed to a developer as a list to hand-code into a script.
3. **Whether any real per-browser data (Settings → Export full backup) should be preserved as a manual, explicitly-identified exception**, even though it won't be migrated automatically as part of this decision. If anyone has been using GOMS for real work pre-cutover, exporting it now — before any browser/profile/machine is at risk of being reset — costs nothing and keeps that option open for later, per-user import, separate from the Admin Data Import feature.

---

## What this document does not do

It does not invent a reference-data list, does not implement the Admin Data Import feature (design only, in the linked spec), and does not provision or migrate anything. Those remain scoped, unstarted work gated on the spec being reviewed and, separately, on Amnex authoring the actual data to upload. Option B stays recorded above only as a fallback if the user later identifies specific real records that must be migrated — it is not the selected path.
