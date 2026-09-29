/** Minimal structural shapes — the real frontend `HierNode`/`Employee`/
 *  `Opportunity` types (and a Postgres row mapped to the same fields)
 *  satisfy these for free. Only the fields ownership resolution touches. */
export interface OwnershipNode {
  id: string
  parentId: string | null
}
export interface OwnershipEmployee {
  id: string
  orgNodeId: string
}
export interface OwnershipOpportunity {
  id: string
  departmentId: string
}
export interface OwnershipBid {
  id: string
  opportunityId: string
}

/** A single ownership/delegation row — the subset of `OwnershipAssignment`
 *  resolution needs. `endDate: null` means "still open". */
export interface OwnershipAssignmentRow {
  entityType: string
  entityId: string
  salesPersonId: string
  role: string
  startDate: string
  endDate: string | null
}

/** What ownership resolution needs to walk. Passed in rather than imported so
 *  this module stays pure and testable — it never touches a repository or a
 *  database directly. */
export interface OwnershipContext {
  nodes: OwnershipNode[]
  employees: OwnershipEmployee[]
  opportunities: OwnershipOpportunity[]
  bids: OwnershipBid[]
}

export interface OwnableEntityDef {
  key: string
  label: string
  icon: string
  /** `hierarchical` walks a same-type ancestor chain; `exact` does not. */
  resolution: 'exact' | 'hierarchical'
  /** Same-type ancestor chain, nearest first. Required when hierarchical. */
  ancestors?(id: string, ctx: OwnershipContext): string[]
  /** Cross-type fallback when this entity has no owner of its own. */
  inheritFrom?(id: string, ctx: OwnershipContext): { entityType: string; entityId: string } | null
}

function orgAncestors(id: string, ctx: OwnershipContext): string[] {
  const byId = new Map(ctx.nodes.map((n) => [n.id, n]))
  const out: string[] = []
  let cur = byId.get(id)?.parentId ?? null
  // Guard against a cycle in hand-edited data: a parent loop would otherwise
  // spin forever inside a render pass.
  const seen = new Set<string>([id])
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    out.push(cur)
    cur = byId.get(cur)?.parentId ?? null
  }
  return out
}

/** Code-level registry — entries are additive, and adding one must not require
 *  touching the resolution engine. Spec §6.1 / §7. */
const OWNABLE_ENTITIES: OwnableEntityDef[] = [
  {
    key: 'orgNode',
    label: 'Organization node',
    icon: 'Building2',
    // One entry covers Ministry, Department, Division, Office and any level
    // added later — the engine never learns about levels.
    resolution: 'hierarchical',
    ancestors: orgAncestors,
  },
  {
    key: 'contact',
    label: 'Contact',
    icon: 'User',
    resolution: 'exact',
    inheritFrom: (id, ctx) => {
      const emp = ctx.employees.find((e) => e.id === id)
      return emp?.orgNodeId ? { entityType: 'orgNode', entityId: emp.orgNodeId } : null
    },
  },
  {
    key: 'opportunity',
    label: 'Opportunity',
    icon: 'Briefcase',
    resolution: 'exact',
    inheritFrom: (id, ctx) => {
      const opp = ctx.opportunities.find((o) => o.id === id)
      return opp ? { entityType: 'orgNode', entityId: opp.departmentId } : null
    },
  },
  {
    key: 'bid',
    label: 'Bid',
    icon: 'FileCheck2',
    resolution: 'exact',
    inheritFrom: (id, ctx) => {
      const bid = ctx.bids.find((b) => b.id === id)
      return bid ? { entityType: 'opportunity', entityId: bid.opportunityId } : null
    },
  },
]

export const OWNABLE_ENTITY_MAP: Record<string, OwnableEntityDef> = Object.fromEntries(
  OWNABLE_ENTITIES.map((d) => [d.key, d]),
)

export interface OwnerResolution {
  salesPersonId: string
  /** `direct` = assigned on this entity. `inherited` = resolved from an
   *  ancestor or a cross-type fallback. The UI MUST distinguish these: showing
   *  an inherited owner as though it were assigned is how people "correct"
   *  data that was never wrong (spec §7). */
  source: 'direct' | 'inherited'
  viaEntityType?: string
  viaEntityId?: string
  /** 0 for direct; how many hops away the owning entity was otherwise. */
  depth: number
}

/** Half-open interval covers `asOf`: `startDate` inclusive, `endDate`
 *  exclusive (`null` = still open). Same semantics as `src/lib/intervals.ts`'s
 *  `coversDate` — duplicated here as a 2-line predicate rather than imported,
 *  since packages/domain has no dependency on frontend-only modules. */
function coversDate(row: { startDate: string; endDate: string | null }, asOf: string): boolean {
  if (asOf < row.startDate) return false
  return row.endDate === null || asOf < row.endDate
}

function directOwner(
  assignments: OwnershipAssignmentRow[],
  entityType: string,
  entityId: string,
  asOf: string,
): OwnershipAssignmentRow | undefined {
  return assignments.find(
    (a) =>
      a.entityType === entityType &&
      a.entityId === entityId &&
      a.role === 'owner' &&
      coversDate(a, asOf),
  )
}

/** The open delegate on an entity at `asOf`, if any. A delegation does not
 *  replace the owner — both resolve, and the UI shows both. */
export function activeDelegate(
  assignments: OwnershipAssignmentRow[],
  entityType: string,
  entityId: string,
  asOf: string,
): OwnershipAssignmentRow | undefined {
  return assignments.find(
    (a) =>
      a.entityType === entityType &&
      a.entityId === entityId &&
      a.role === 'delegate' &&
      coversDate(a, asOf),
  )
}

/** Resolves who effectively owns an entity, following the four-step chain in
 *  spec §7: direct → same-type ancestor → cross-type fallback → none.
 *
 *  PERFORMANCE: this walks ancestors, so it must be called once per resolution
 *  pass into a memoized map — never inside a render loop. `buildOwnerMap` below
 *  is the intended entry point for lists; §13 names this the design's single
 *  largest performance risk. */
export function effectiveOwner(
  assignments: OwnershipAssignmentRow[],
  entityType: string,
  entityId: string,
  asOf: string,
  ctx: OwnershipContext,
  /** Guards against an `inheritFrom` cycle across entity types. */
  visited: Set<string> = new Set(),
): OwnerResolution | null {
  const key = `${entityType}:${entityId}`
  if (visited.has(key)) return null
  visited.add(key)

  const def = OWNABLE_ENTITY_MAP[entityType]
  if (!def) return null

  // 1. Direct.
  const direct = directOwner(assignments, entityType, entityId, asOf)
  if (direct) return { salesPersonId: direct.salesPersonId, source: 'direct', depth: 0 }

  // 2. Nearest same-type ancestor with a direct owner.
  if (def.resolution === 'hierarchical' && def.ancestors) {
    const chain = def.ancestors(entityId, ctx)
    for (let i = 0; i < chain.length; i++) {
      const found = directOwner(assignments, entityType, chain[i], asOf)
      if (found) {
        return {
          salesPersonId: found.salesPersonId,
          source: 'inherited',
          viaEntityType: entityType,
          viaEntityId: chain[i],
          depth: i + 1,
        }
      }
    }
  }

  // 3. Cross-type fallback — re-enters the chain on the referenced entity.
  const ref = def.inheritFrom?.(entityId, ctx) ?? null
  if (ref) {
    const up = effectiveOwner(assignments, ref.entityType, ref.entityId, asOf, ctx, visited)
    if (up) {
      return {
        salesPersonId: up.salesPersonId,
        source: 'inherited',
        viaEntityType: up.source === 'direct' ? ref.entityType : up.viaEntityType,
        viaEntityId: up.source === 'direct' ? ref.entityId : up.viaEntityId,
        depth: up.depth + 1,
      }
    }
  }

  // 4. None. Note this is a real gap only for an entity with no effective
  //    owner anywhere up its chain — a department under an owned ministry is
  //    NOT a gap (spec §7).
  return null
}

/** Resolves many entities of one type in a single pass, memoized by key.
 *  Use this for any list; calling `effectiveOwner` per row re-walks the
 *  ancestor chain for every row. */
export function buildOwnerMap(
  assignments: OwnershipAssignmentRow[],
  entityType: string,
  entityIds: string[],
  asOf: string,
  ctx: OwnershipContext,
): Map<string, OwnerResolution> {
  const out = new Map<string, OwnerResolution>()
  for (const id of entityIds) {
    const res = effectiveOwner(assignments, entityType, id, asOf, ctx)
    if (res) out.set(id, res)
  }
  return out
}
