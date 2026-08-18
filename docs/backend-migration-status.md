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
| hierarchy | Not started | — | Depends on both `departments` and `geography` migrating their own-methods first (see spec §6). |
| departments | Not started | — | |
| geography | Not started | — | |
| employees | Not started | — | |
| ownership | Not started | — | Opportunities, ownership assignments, follow-ups. |
| salesPeople | Not started | — | |
| commercialMasters | Not started | — | |
| commercialSkus | Not started | — | |
| commercialBom | Not started | — | |
| commercialBoqs | Not started | — | |
| auditLogs | Not started | — | |
| crossCutting | Not started | — | search/relatedRecords/relationshipAnalytics — likely migrates last, after the domains it reads span are done. |
| customers | Not applicable yet | — | New entity, no `Repository` methods exist for it yet — added together with its first consumer in Phase 2. |

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
