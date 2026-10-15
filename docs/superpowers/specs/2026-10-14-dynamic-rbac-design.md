# Dynamic hierarchical RBAC (UI permission tree) — design

Date: 2026-10-14 · Status: implemented on `Shubham_Side` (uncommitted) · Related: `2026-10-06-rbac-design.md` (server policy "A")

## 1. Goal and layering

GOMS already enforces a server-side policy (A): 8 functional roles + System Admin, 25 policy modules, the `CELLS` matrix
and field atoms, checked per tRPC procedure. A stays the **data-security floor**.

This adds a persisted, auto-discovered **permission tree** of every UI surface (module → page → tab → sub-tab → section →
view → action area) that decides what a user *sees and can do in the UI*:

    effective(UI) = A allows  AND  tree allows

The tree can only narrow, never widen. System Admins (env allow-list) are never restricted by the tree, so nobody can lock
the administrators out of Settings → Roles & Access. A later plan (`2026-10-14-rbac-unification-plan.md`) folds A into the tree.

## 2. Node model (`packages/domain/src/rbac/tree/`)

- **Id**: dotted path, `parentId + '.' + key` (keys never contain dots), e.g. `opportunity.bid.general.attachments`.
  The parent is therefore derivable from the id, which lets the browser resolve a node it has never seen (a just-created
  saved view) by walking up to the nearest known ancestor.
- **Kinds**: `module | page | tab | subtab | section | view | action-area`.
- **Actions**: `view create edit delete download manage`. A node declares which apply (defaults per kind: containers get
  all six because they act as cascading defaults; a `view` gets view/edit/delete). The resolver evaluates all six on every
  node so a module-level "deny edit" cascades through children that do not show an edit cell.
- **Dynamic nodes**: a node may carry `dynamic: { source: 'savedViews', sheet }`. Its children are generated at read time
  from the system views (`SYSTEM_BID_VIEWS`) and the `bid_saved_views` rows of that sheet (`expandDynamicNodes`).

## 3. Discovery (by construction) — `src/lib/rbacTree/`

- `definePermissionNodes(parent, items, opts)` — the **same array** that renders a tab bar is passed through it and returned
  unchanged; each item becomes a node (`id = parent.key`). Used by OPPORTUNITY_TABS, PIPELINE_TABS, Bid Tracker SECTIONS,
  BidDetail TABS, Insights TABS, Sales SECTIONS, Teams TABS/SECTIONS, Commercial SECTIONS, SkuCatalog TABS, SETTINGS_GROUPS,
  the app modules (left rail).
- `defineSection(parent, key, label, opts)` — module-scope declaration of a section / action area, returning its id, used
  with `<Secured node=…>` / `useNodeAccess(id, action)`.
- Routes: `src/app/routeNodes.ts` declares page nodes; every route in `router.tsx` carries `handle: { rbac: { id } }`.
  `RouteNodeGuard` (in AppLayout) reads `useMatches()` and renders `NoAccess` when the deepest route node is not viewable.
- `npm run rbac:manifest` runs the collector under Vitest (aliases, JSX, `import.meta.env`): it imports every source file
  that calls a `define*` function plus the router, and writes
  `packages/domain/src/rbac/tree/manifest.generated.ts` (checked in; consumed by the API and the local store).
- `src/lib/rbacTree/manifest.test.tsx` **fails** when the manifest is stale, when a route lacks `handle.rbac`, when a route
  points at an unknown node, or when a `const …TABS/SECTIONS = [` declaration is not passed through `definePermissionNodes`.

## 4. Persistence (`apps/api/migrations/1791764700000_rbac-tree.sql`)

| table | purpose |
|---|---|
| `rbac_nodes` | synced manifest: id, parent_id, label, kind, actions[], sort_order, dynamic jsonb, `retired_at` |
| `rbac_custom_roles`, `rbac_custom_role_members` | admin-created roles (subject id `custom:<uuid>`) assigned by email |
| `rbac_templates` | named permission templates |
| `rbac_template_links` | linked mode: one template per role/user subject; editing the template updates every linked subject |
| `rbac_grants` | `(subject_type, subject_id, node_id, action) → allow|deny`; *inherit = no row*; no FK to nodes |

Sync (API boot + "Sync now"): upsert every manifest node, un-retire reappearing nodes, set `retired_at` on nodes that are
gone. Grants are **never** deleted by sync; retired nodes stay visible (greyed) in the editor with their grants.

## 5. Resolution (`resolveTree`, pure, unit-tested)

Per node and action, the first explicit value wins:

1. the user's own override (subject `user:<email>`)
2. the user's role configs (functional roles from A + custom roles by membership) — across roles **allow wins over deny**
3. template defaults (templates linked to the user or to any of their roles) — allow wins across templates
4. inherit the parent's resolved value
5. root default **allow** (nothing changes before anyone configures anything)

Then **View gating**: a node is viewable only if it and all its ancestors resolve View = allow (deny View on a parent hides
the subtree), and every other action additionally requires the node to be viewable. The resolver also reports *where*
each value came from (layer + node) for the editor's tooltips.

## 6. API — `rbacTree` router

Reads (`accessProcedure`, registry `read('admin.access')`): `nodes`, `subjects`, `getConfig`, `history`, `preview`.
Writes (`systemAdminProcedure`, registry `write/remove('admin.access')`): `sync`, `setConfig`, `createRole`, `updateRole`,
`deleteRole`, `createTemplate`, `updateTemplate`, `duplicateTemplate`, `deleteTemplate`, `applyTemplate`, `unlinkTemplate`.
`myAccess` is `self` (every signed-in user, resolved server-side, cached 30 s per email, cleared on every write; the browser
caches it 60 s like `auth.me`). Every grant/template/role change writes `commercial_audit_logs` rows with
`entity_type = 'rbac_tree'`, which the generic audit feed excludes (like role overrides). Permission mutations require a
recent sign-in, like `access.*`.

## 7. UI

- **Settings → System settings → Roles & Access** (`/settings/access`; `/admin/access*` redirect there). The left-rail and
  mobile-drawer entries are removed. System Admins edit; other `admin.access` readers view read-only.
- Editor: subject picker (Roles / Users / Templates tabs + search, custom role creation) and a tree table (indentation, kind
  icons, expand/collapse all, search, "show retired") with tri-state cells per action — *inherit* is shown faded with the
  inherited effective value and a tooltip naming its source; a click cycles inherit → allow → deny. Row "apply to children"
  clears descendants' overrides so they follow the row. Dirty-state Save / Discard, "Save as template", "Apply template"
  (multi-select roles/users, keep or replace existing overrides), linked-subject chips, audit history, "Preview as user".
  "Import starter templates" converts the old xlsx Access Matrix (team × level) into one template per team (best effort,
  section-level mapping; unmapped sections are reported).
- Enforcement: `useNodeAccess(id, action)`, `<Secured>`, `filterByNode` for tab bars (redirect to the first allowed tab),
  `<Can node=…>` combines A and the tree. Wired into the left rail / drawer, routes, Opportunity / Bid Tracker / Bid detail /
  Insights / Teams / Sales / Commercial / SKU tab bars, saved-view tabs, Bid Tracker create/delete/download buttons, bid
  detail archive/delete, attachments, Document maker, Competitors, Commercial Calculator.
- Local mode (no `VITE_API_BASE_URL`): the config lives in the in-memory repository (persisted with the snapshot) and is
  resolved for the signed-in email (if any); with no config everything is allowed.

## 8. Out of scope / follow-ups

- Server enforcement of the tree (see the unification plan). Field-level (atom) nodes. Multiple templates per subject.
- The legacy `src/modules/admin-access/` screens (AccessMatrix, AccessManagement) are unrouted and can be deleted once the
  starter-template import is no longer needed.
