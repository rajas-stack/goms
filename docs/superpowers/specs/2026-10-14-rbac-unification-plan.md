# RBAC unification plan — one system (server policy A folded into the permission tree)

Date: 2026-10-14 · Status: PLAN ONLY (not implemented) · Builds on `2026-10-14-dynamic-rbac-design.md` and `2026-10-06-rbac-design.md`

## 1. Where we are

- **A (server policy)**: `PROCEDURE_POLICY` maps ~200 tRPC procedures to `Check`s on 25 `PolicyModuleKey`s with
  read / create / update(atoms) / delete, evaluated against the `CELLS` matrix (level N/R/P/W, scope all/own/asg, field sets).
- **Tree (B')**: persisted UI nodes × actions (view/create/edit/delete/download/manage) per role / user / template,
  resolved in `packages/domain/src/rbac/tree/resolve.ts`, enforced only in the browser. Effective UI = A AND tree.

## 2. Target

One authority: the tree (nodes + grants + templates) decides both what the UI shows and what the server executes. Row
scope (own / asg) and field atoms stay as *qualifiers* on a grant, not separate systems.

## 3. Mapping A onto the tree

| A concept | Tree concept |
|---|---|
| `PolicyModuleKey` (25) | a **data node** under a new `data.*` root (e.g. `data.opp.bidTracker`), or attached to the existing UI node that owns the data (`opportunity.bid-tracker.grid` ↔ `opp.bidTracker`). Keep a `DATA_NODE_OF: Record<PolicyModuleKey, nodeId>` table in domain, tested for completeness. |
| `read` | `view` |
| `create` / `delete` | `create` / `delete` |
| `update` with atoms | `edit` on the module node; each atom (`opp.value`, `bid.decision`, …) becomes an `action-area` child node `data.<module>.<atom>` with `edit`, so field sets (S1, P1, …) become "edit allowed on these atom nodes" |
| Level `P` | `edit` allowed on the atom nodes of the set, denied on the module node |
| Scope `own` / `asg` | a grant **qualifier** `scope: 'all' | 'own' | 'asg'` (new nullable column on `rbac_grants`); the server evaluator keeps `ScopeFacts` and checks the qualifier against the row |
| `SYSTEM_ADMIN_ONLY` rules | stay code-level (not configurable), listed read-only in the editor |
| `anyOf` dependent reads | expressed as "view on any of these nodes" in the procedure map (unchanged structure) |

Each registry entry changes from `requirements: [write('opp.bidTracker', atoms)]` to
`requirements: [node('data.opp.bidTracker', 'edit', atoms)]`. A codemod can rewrite the five registry files mechanically
because `read/create/write/remove/readAny/bidRow/oppRow` are the only builders; `completeness.test.ts` keeps guarding
coverage, plus a new test that every node a procedure names exists in the manifest.

## 4. Server-side resolver reuse

- Move nothing: `resolveTree` / `userLayers` are already pure and live in `@goms/domain`, consumed by the API
  (`apps/api/src/lib/rbacTreeStore.ts → resolveForEmail`). Add `scope` to `RbacResolvedCell` and a
  `treeDecide(access, nodeId, action, row?)` next to today's `accessFor`.
- `decide.ts` gains a second evaluator behind a flag; `guard.ts` keeps its modes.
- Cache: per-email resolution (30 s, cleared on every tree write) is already in place; add an explicit version counter in
  `rbac_nodes`/`rbac_grants` (bumped by trigger) so multiple API instances invalidate together.

## 5. Migrating CELLS defaults to seeded role configs

1. Generate, per functional role, the grants that reproduce `GRANTS[module][role]` exactly (level → view/edit/create/delete
   on module + atom nodes; scope → qualifier). A pure function `cellsToGrants()` in domain, unit-tested by round-tripping
   every cell through `treeDecide` vs `accessFor` for synthetic rows (all roles × modules × own/asg/other rows × atoms).
2. Seed them as **templates** named `Default · <Role>` linked to each functional role (linked mode), so admins can see and
   later diverge from the defaults without editing code.
3. System Admin stays allow-list-only and unrestricted.

## 6. Shadow-mode rollout

1. `RBAC_TREE_SERVER=shadow`: every call evaluates both A and the tree; log `rbac.tree_mismatch` (path, email, node, action,
   A verdict, tree verdict). Dashboard the mismatch rate per procedure.
2. Fix mappings until mismatches are only intended configuration differences (admins' narrowing in the tree).
3. `RBAC_TREE_SERVER=enforce` per environment (dev → prod), keeping `RBAC_MODE` as the kill switch.
4. Remove `CELLS`/`GRANTS` evaluation after one release in enforce; keep `cellsToGrants` for re-seeding.

## 7. Risks

- **Lockout**: a deny on `settings.system.access` or `data.admin.access` must never apply to System Admins (already true) and
  the editor should warn before saving a configuration that leaves no non-admin able to read Role & Access.
- **Widening by mistake**: today the tree can only narrow. After unification an `allow` grants real data access; the editor
  needs a "server effect" column and an audit diff, and `allow` on data nodes should require a confirmation.
- **Atom drift**: a new field without an atom node fails closed today (`patchAtoms`); keep that behaviour and add the atom
  node to the manifest test.
- **Row scope** semantics (own / asg) are subtle; keep them in code, configurable only as qualifiers chosen from a fixed list.
- **Performance**: resolution is O(nodes × actions) per user, cached; procedure checks become map lookups.
- **Two sources of truth during shadow**: time-box it; the mismatch log is the exit criterion.
