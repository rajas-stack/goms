# GOMS Backend Migration Status

Tracks which `Repository` domains have been migrated from the in-memory
implementation to a Supabase-backed one. Updated after every domain
migration, per architecture spec §7's per-domain checklist — never skip
updating this when a domain's status changes.

See `docs/superpowers/specs/2026-08-18-goms-backend-architecture-design.md`
for the full design and `docs/superpowers/plans/2026-08-18-goms-backend-phase1-implementation-plan.md`
for how the schema/tooling below were built.

## Domain status

| Domain | Status | Migrated on | Notes |
|---|---|---|---|
| hierarchy | Migrated | 2026-08-18 | New id-prefix dispatch (`org_`/`geo_`), no in-memory precedent — see plan Task 4. Cascade deletes moved to Postgres FKs (`employees.department_id`, `opportunities.department_id` now `ON DELETE CASCADE`) rather than application code. Migration numbering shifted to `00000000000013`/`00000000000014` (Task 3's grant-privileges fix already claimed `...012`). `database.types.ts` regenerated (`npm run supabase:types`) to pick up the two new subtree-id RPC functions. |
| departments | Migrated | 2026-08-18 | `listOrgRoots`/`listDepartments`/`listPostingNodes` now Supabase-backed. `hierarchy` bucket still in-memory — depends on `geography` migrating too (Phase 2 Task 4). Uncovered and fixed two real bugs: (1) Postgres's `anon`/`authenticated` roles had no baseline table GRANTs at all — RLS's permissive policies never mattered because Postgres denies before RLS is evaluated; invisible in Phase 1 since every verification ran as the `postgres` superuser, which bypasses grants — fixed via a new migration granting `SELECT/INSERT/UPDATE/DELETE` + default privileges for future tables. (2) `listDepartments()` was missing a `type_key = 'department'` filter, initially returning every active org node (branches/offices/units too) — caught by its own integration test. |
| geography | Migrated | 2026-08-18 | `listStates`/`getState`/`geoRoot`/`childCounts` now Supabase-backed. `listStates` still bridges to `inMemoryRepository.listAllEmployees()` for employee counts until Task 5 migrates `employees`. |
| employees | Migrated | 2026-08-18 | New `merge_audit_records` table + `merge_employees()` Postgres function (Phase 1 didn't create this table). Known pre-existing bug preserved: `deleteEmployee` never reassigns direct reports to the deleted employee's own manager (always null) — recommend a dedicated correctness fix in a later pass, tracked separately from this migration. Task 3's employees-count bridge in `geography.ts` removed (now a direct Postgres join). One schema-forced representational difference (not a behavior change): `addTimelineEvent`'s `attendees` column is `NOT NULL default '{}'`, so an omitted attendee list stores as `[]` instead of the in-memory version's `undefined` — every consumer treats the two identically. Migration numbered `00000000000015` (Task 4 already claimed `...013`/`...014`). |
| ownership | Migrated | 2026-08-18 | `assignOwner`/`transferBookOfBusiness` now Postgres functions (`assign_owner`/`transfer_book_of_business`) for atomicity — same reasoning as `merge_employees` (Task 5). `src/data/ownership.ts`'s resolution engine (`effectiveOwner`/`buildOwnerMap`) is unchanged; only its inputs are now Postgres-sourced. `deleteOpportunity`'s non-cascade to ownership/follow-up rows is a preserved pre-existing gap, not new. Migration numbered `00000000000017`. Uncovered and fixed a real Phase 1 gap: `pipeline_stages` had a schema but was never seeded, so `opportunities.stage_key`'s `NOT NULL` FK had nothing to reference — every `createOpportunity` call would have failed in any fresh environment. Seeded it in `supabase/seed.sql` from `PIPELINE_STAGES` (`src/data/pipeline-stages.ts`). This is Phase 2's last domain — every domain this plan covers is now migrated; `commercialMasters`/`commercialSkus`/`commercialBom`/`commercialBoqs`/`auditLogs`/`crossCutting` remain in-memory (Phase 3+). |
| salesPeople | Migrated | 2026-08-18 | `ownership_assignments.sales_person_id` now `ON DELETE CASCADE`, `follow_ups.assignee_id` and `opportunities.sales_person_id` now `ON DELETE SET NULL`. `commercial_boqs.sales_person_id` deliberately left `NO ACTION` (Commercial Calculator is Phase 3). Migration numbered `00000000000016` (Task 5 already claimed `...015`). Mapped `sales_postings.start_date` (nullable DB column) back to `''` in `toSalesPosting` — `SalesPosting.startDate` is a non-nullable `string` in the app, using `''` as the "unknown" sentinel per `sales-roster-seed.ts`; leaving it `null` would have leaked a type violation into every consumer. |
| commercialMasters | Migrated | 2026-08-18 | `listMaster`/`getMaster`/`createMaster`/`updateMaster`/`setMasterActive`/`deleteMaster`/`listEditionFeatures`/`setEditionFeatures` now Supabase-backed, generic across all 12 master kinds via a `TABLE_FOR_KEY`/`EXTRA_FIELDS` map (`src/data/supabase/commercial-masters.ts`) rather than 12 hand-written CRUD files. New `Repository` method `recordCommercialAuditLogEntry` added as a permanent bridge into the still-in-memory `auditLogs` domain (not resolved until Phase 5) — delegates to a newly-exported `writeAuditLogEntry` in `repository-logic.ts`. IDs are now DB-generated `uuid`, not app-generated `uid('mst')` strings. **Real bug found and fixed during implementation**: base-currency exclusivity must clear every other row's `is_base_currency` *before* inserting/updating the new winner, never after — the initial implementation set the winner true first, which immediately tripped Phase 1's `commercial_currencies_one_base_idx` partial unique index (two `true` rows existing simultaneously, even momentarily, is rejected). **Second bug found and fixed**: `src/data/persist.ts`'s `scheduleSave`/`reportPersistFailure`/`attempt` touched `document`/`window` unconditionally — harmless in real browsers but crashed the moment a Supabase-backed write called the new audit-log bridge from Node (the integration test environment), since that bridge runs through the same persistence-wrapping proxy as every in-memory mutator. Fixed with `typeof document === 'undefined'` / `typeof window === 'undefined'` guards; production behavior is unchanged. |
| commercialSkus | Migrated | 2026-08-18 | `listSkus`/`getSku`/`createSku`/`updateSku`/`deleteSku` now Supabase-backed. `generateSkuCode` ported as a single nested-select query (feature→module→product→vertical via PostgREST embedding) instead of four sequential array scans. `STANDARD_EDITION_ID` constant replaced by a `code = 'STD'` lookup. `deleteSku` carries two bridges into the still-in-memory blob: BOM usage (temporary — removed when `commercialBom` migrated later this same phase) and BOQ-line-item usage (permanent for now — remains a bridge until Phase 4 migrates `commercialBoqs`; **flagged here explicitly as a Phase 4 dependency**). |
| commercialBom | Migrated | 2026-08-18 | `listBomItemsForSku`/`listAllBomItems`/`createBomItem`/`updateBomItem`/`deleteBomItem` now Supabase-backed. `commercial-skus.ts`'s `deleteSku` BOM-usage check switched from the temporary in-memory bridge to a real `commercial_bom_items` query (`parent_sku_id`/`component_sku_id` OR filter). Its BOQ-line-item usage check remains an in-memory bridge — see the `commercialSkus` row above. This closes out Phase 3 — `commercialBoqs`, `auditLogs`, and `crossCutting` remain in-memory (Phase 4/5 scope). |
| commercialBoqs | Not started | — | |
| auditLogs | Not started | — | |
| crossCutting | Not started | — | search/relatedRecords/relationshipAnalytics — likely migrates last, after the domains it reads span are done. |
| customers | Migrated | 2026-08-18 | New domain, not a migration — no prior in-memory behavior existed. `Repository` interface gained 5 new methods. No UI consumes this yet (out of scope for this task) — verified via a direct repository round-trip in the browser console instead. Deviation from the plan text: the plan didn't account for `migrations.ts`'s versioned snapshot-upgrade system — added `SCHEMA_VERSION` 9→10 and a `toV10` migration so existing users' persisted IndexedDB snapshots backfill `customers: []` instead of leaving the field undefined at runtime. |

## Schema status

All tables for every domain above were created in Phase 1 (see the migration
files under `supabase/migrations/`) — schema existing does **not** imply a
domain is migrated. A domain is "migrated" only once its `Repository`
methods are reassigned from the in-memory implementation to a
Supabase-backed one in `src/data/repository-select.ts`'s `MIGRATED` set,
per the full checklist in the architecture spec §7.

## In-memory fallback removal

**Not yet eligible.** Per architecture spec §7/§8, `src/data/in-memory/repository.ts`
and the IndexedDB persistence path (`src/data/persist.ts`) are not removed
until every single domain above shows "Migrated" — this is a hard gate, not
a per-domain-optional cleanup.

## Deployment target (not yet started)

Per architecture spec §8 Phase 9: the end state is a hosted React/Vite
frontend talking to a Supabase Cloud PostgreSQL project, reachable by any
user in a plain browser with no Docker/CLI/local backend on their end. The
local Supabase stack built in this phase is dev/test tooling only and is
never what end users connect to. Not started — depends on Phase 7 (cutover)
and Phase 8 (security gate) completing first.
