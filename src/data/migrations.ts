import { uid } from '@/lib/utils'
import { buildOwnershipFixture } from './ownership-fixture'
import { buildSalesRoster, mergeMissingSalesRoster } from './sales-roster-seed'
import { SALES_TEAM } from './sales-team'
import { mergeTeamRosters } from './pre-sales-team'
import { mergeOrgSeed, syncAllTeamsFromOrg, type OrgPerson } from './org-structure'
import type { DeliveryTeamMember, HierNode, Opportunity } from '@/lib/types'
import { assignMissingOpportunityCodes } from './opportunityCodes'
import type { GormsData } from './seed'
import { buildDefaultCommercialCalculatorData } from '@/modules/commercial-calculator/seed-defaults'

/** Bump when `GormsData`'s shape changes, and add a matching entry to
 *  `MIGRATIONS` keyed by the new number. Unlike the previous
 *  discard-on-mismatch behavior, a stored snapshot is now upgraded in
 *  place — hand-entered data survives a schema change.
 *
 *  v1  the original shape (nodes, employees, externalIds, timeline, transfers)
 *  v2  opportunities + opportunityStageChanges; works leave node metadata
 *  v3  followUps
 *  v4  salesPersons + salesPostings, seeded from the SALES_TEAM constant
 *  v5  ownershipAssignments
 *  v6  tops up salesPersons/salesPostings against SALES_TEAM (fixes rosters
 *      that got stuck below full headcount by an earlier, non-topping-up v4)
 *  v7  corrects current-posting tierKey for SALES_TEAM members with an
 *      explicit `tiers` override (fixes territory heads seeded at the wrong
 *      tier by an earlier, incorrectly-ordered `tiers` array)
 *  v8  Commercial Calculator data slice (GormsData.commercialCalculator) —
 *      seeded with FRS default masters; a snapshot that already has this key
 *      is left untouched rather than overwritten.
 *  v9  Backfills the Commercial Calculator SKU/BOM/BOQ/audit-log collections
 *      (Phase 2+3) onto a v8 snapshot, which only had masters/productEditionFeatures.
 *      Existing masters/productEditionFeatures data is preserved untouched.
 *  v10 customers (Phase 2 Task 6). Starts empty — a new entity with no prior
 *      in-memory data to backfill, and 'customers' is Supabase-backed from
 *      creation, so this only exists to keep GormsData's shape complete.
 *  v11 Backfills `selectedPricingLevels: []` onto every existing SKU row —
 *      the field was added to `CommercialSku` (2026-08-20 pricing-overhaul)
 *      with no migration, so SKUs seeded/created before that change had it
 *      missing entirely rather than empty, crashing any UI that assumed it
 *      was always an array (SkuFormDialog, maxDiscountPercentForLevel).
 *  v12 Backfills `pricingLevels: []`/`activePricingLevel: null` onto every
 *      existing BOQ line item row — the same 2026-08-20 pricing-overhaul
 *      added these fields to `CommercialBoqLineItem` too, but only the SKU
 *      side got a migration (v11). Line items created before the overhaul
 *      had `pricingLevels` missing entirely, crashing `SellingPriceSection`
 *      (`pricingLevels.some(...)`) and `withLiveDraftPricing` on any draft
 *      BOQ containing one.
 *  v13 Bid Tracker's eight new collections (bids, bidMilestones,
 *      bidCorrigenda, bidCorrigendumChanges, protectedValues, bidDocuments,
 *      documentCitations, bidSavedViews) — same "new entity, no prior data,
 *      starts empty" pattern as v10's `customers`.
 *  v14 Bid Tracker custom columns (spec §8.1): `bidCustomFields` and
 *      `bidCustomFieldValues`, both starting empty.
 *  v15 `bidCustomFields[].hasHeldValue` — the durable "has ever held a value"
 *      flag that gates hard deletion (spec §8.1). Backfilled from whether the
 *      column currently has any value rows.
 *  v16 delivery-team roster and opportunity role references. Starts with an
 *      empty non-Sales roster and null assignments; never guesses from Sales
 *      ownership or legacy salesPersonEmail.
 *  v17 `deliveryTeamMembers[].managerId` (reports-to, for the team org
 *      charts). Backfilled to null — everyone starts as a root.
 *  v18 `deliveryTeamMembers[].designation` backfilled to '', then the Pre-sales
 *      roster (pre-sales-team.ts) topped up by name — same "add what's
 *      missing, never overwrite" rule as v6's sales roster.
 *  v19 Dharmesh Dhamecha's Bid Management group moves from the Pre-sales
 *      roster to the Bid team (Shamik Joshi heading both); re-runs the same
 *      idempotent roster merge, which relocates the seeded entries.
 *  v20 Opportunity ID: `opportunities[].opportunityType` backfilled to '', and
 *      every opportunity without an `opportunityCode` gets one (createdAt,
 *      then id, order) from the new per-fiscal-year `opportunityCodeSequences`
 *      counters — the same builder a newly created opportunity goes through
 *      (opportunityCodes.ts). An existing code is never changed.
 *  v21 Company Org Structure (`orgPeople`, org-structure.ts) seeded by name,
 *      then the Pre-sales / Bid / Legal rosters re-derived from it (existing
 *      member ids kept, so opportunity assignments still resolve).
 */
export const SCHEMA_VERSION = 21

/** Migrations run over loosely-typed data: an old snapshot by definition
 *  does not match today's `GormsData`, so typing the input as `GormsData`
 *  would be a lie that hides real shape differences. */
export type SnapshotShape = Record<string, unknown>

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : []
}

/** Reads a department's legacy `metadata.works` JSON. Mirrors the old
 *  `parseWorks`, including its migration of a single-string `component`
 *  to a one-item array. Malformed JSON yields an empty list rather than
 *  throwing — a corrupt blob must not block the whole migration. */
function parseLegacyWorks(raw: unknown): Record<string, unknown>[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return (parsed as Record<string, unknown>[]).map((w) => ({
      ...w,
      component: Array.isArray(w.component) ? w.component : w.component ? [w.component] : [],
    }))
  } catch {
    return []
  }
}

/** v1 → v2. Lifts every department's `metadata.works` blob into a real
 *  `opportunities` collection and removes the metadata key.
 *
 *  Deliberately writes NO `opportunityStageChange` rows: a migrated
 *  opportunity's real stage history is unknown, and inventing one would
 *  put fabricated data into the substrate the analytics layer reads.
 *  Stage history begins at the first stage change made in the app. */
function toV2(data: SnapshotShape): SnapshotShape {
  if (!Array.isArray(data.nodes)) {
    throw new Error('Invalid snapshot: nodes must be an array')
  }
  const nodes = asArray(data.nodes)
  const opportunities: Record<string, unknown>[] = []

  for (const node of nodes) {
    const metadata = (node.metadata ?? {}) as Record<string, unknown>
    if (!('works' in metadata)) continue

    for (const w of parseLegacyWorks(metadata.works)) {
      opportunities.push({
        ...w,
        id: typeof w.id === 'string' && w.id ? w.id : uid('opp'),
        departmentId: node.id,
        stateCode: node.stateCode ?? null,
        stageKey: 'pipeline',
        closedOn: null,
        createdAt: '',
        createdBy: null,
      })
    }

    const { works: _dropped, ...rest } = metadata
    node.metadata = rest
  }

  return { ...data, nodes, opportunities, opportunityStageChanges: [] }
}

/** v2 → v3. Turns each employee's single `followUpDate` field into a real
 *  `FollowUp` record.
 *
 *  `employee.followUpDate` is intentionally left in place: it is still read
 *  by the search intent filters and the employee form, and Phase 3 removes
 *  it once `FollowUp` fully replaces it. Removing it here would break those
 *  call sites mid-phase. */
function toV3(data: SnapshotShape): SnapshotShape {
  const employees = asArray(data.employees)
  const followUps: Record<string, unknown>[] = []

  for (const e of employees) {
    if (typeof e.followUpDate !== 'string' || !e.followUpDate) continue
    followUps.push({
      id: uid('fup'),
      entityType: 'contact',
      entityId: e.id,
      assigneeId: null,
      dueDate: e.followUpDate,
      status: 'open',
      note: '',
      createdAt: '',
      createdBy: null,
    })
  }

  return { ...data, followUps }
}

/** v3 → v4. Seeds `salesPersons` + `salesPostings` from the `SALES_TEAM`
 *  constant, using the same builder a fresh install uses so the two paths
 *  cannot drift. See `sales-roster-seed.ts` for what the mapping does.
 *
 *  A non-empty existing roster is topped up rather than skipped: a snapshot
 *  captured before someone was added to `SALES_TEAM` would otherwise stay
 *  short of the full roster forever, since this step only ran once per
 *  browser. Topping up never clobbers existing records — it only adds
 *  members missing by email. */
function toV4(data: SnapshotShape): SnapshotShape {
  const existingPersons = asArray(data.salesPersons)
  if (existingPersons.length > 0) {
    const merged = mergeMissingSalesRoster(
      existingPersons as unknown as Parameters<typeof mergeMissingSalesRoster>[0],
      asArray(data.salesPostings) as unknown as Parameters<typeof mergeMissingSalesRoster>[1],
    )
    return { ...data, ...merged }
  }
  return { ...data, ...buildSalesRoster() }
}

/** v4 → v5. Adds the ownership table. Starts empty by design: there is no
 *  legacy field that reliably says who owned what as of when. The three
 *  email-keyed metadata fields that hint at it (`salesGeo`,
 *  `relationshipOwner`, `Opportunity.salesPersonEmail`) carry no dates, so
 *  converting them would invent start dates for intervals the whole ownership
 *  model depends on. They are read as a fallback in the UI instead, and Phase 3
 *  proper migrates them once a real effective date can be captured. */
function toV5(data: SnapshotShape): SnapshotShape {
  const existing = asArray(data.ownershipAssignments)
  if (existing.length > 0) return { ...data, ownershipAssignments: existing }
  // Demo fixture, same as a fresh install — see ownership-fixture.ts.
  const nodes = asArray(data.nodes) as unknown as Parameters<typeof buildOwnershipFixture>[0]
  const salesPersons = asArray(data.salesPersons) as unknown as Parameters<typeof buildOwnershipFixture>[1]
  return { ...data, ownershipAssignments: buildOwnershipFixture(nodes, salesPersons) }
}

/** v5 → v6. One-time top-up for snapshots that reached v5 while `toV4` still
 *  skipped a non-empty roster outright: any browser whose `salesPersons` was
 *  seeded before it fully matched `SALES_TEAM` was stuck below full headcount
 *  forever, since `toV4` never ran again after v4 was reached. Runs the same
 *  merge `toV4` now does, so it's a no-op for anyone already in sync. */
function toV6(data: SnapshotShape): SnapshotShape {
  const merged = mergeMissingSalesRoster(
    asArray(data.salesPersons) as unknown as Parameters<typeof mergeMissingSalesRoster>[0],
    asArray(data.salesPostings) as unknown as Parameters<typeof mergeMissingSalesRoster>[1],
  )
  return { ...data, ...merged }
}

/** v6 → v7. Territory heads whose designation is ambiguous ("Regional
 *  Manager & Head") carry an explicit `tiers` override in `SALES_TEAM`, most
 *  senior tier first (spec: `sales-roster-seed.ts`'s seeding comment). That
 *  array was originally written `['rm', 'gm']` — least-senior first — so
 *  every browser that seeded before the fix got 'rm' baked into these
 *  people's current posting instead of the more senior 'gm'. Corrects the
 *  CURRENT posting's `tierKey` only; a posting that already ended is history
 *  and stays as recorded. A no-op for anyone whose data already matches. */
function toV7(data: SnapshotShape): SnapshotShape {
  const salesPersons = asArray(data.salesPersons)
  const postings = asArray(data.salesPostings)
  const emailById = new Map(salesPersons.map((p) => [p.id as string, p.officialEmail as string]))
  const tierOverrideByEmail = new Map(
    SALES_TEAM.filter((m) => m.tiers && m.tiers.length > 0).map((m) => [m.email, m.tiers![0]]),
  )

  const corrected = postings.map((posting) => {
    if (posting.endDate !== null) return posting
    const email = emailById.get(posting.salesPersonId as string)
    const correctTier = email ? tierOverrideByEmail.get(email) : undefined
    if (!correctTier || posting.tierKey === correctTier) return posting
    return { ...posting, tierKey: correctTier }
  })

  return { ...data, salesPostings: corrected }
}

/** v7 → v8. Adds the Commercial Calculator module's data slice. Idempotent:
 *  a snapshot that somehow already has a `commercialCalculator` key
 *  (shouldn't happen pre-v8) is left alone rather than overwritten, so
 *  re-running this step never loses admin edits. */
function toV8(data: SnapshotShape): SnapshotShape {
  if (data.commercialCalculator && typeof data.commercialCalculator === 'object' && !Array.isArray(data.commercialCalculator)) return data
  return { ...data, commercialCalculator: buildDefaultCommercialCalculatorData() }
}

/** v8 → v9. A v8 snapshot's `commercialCalculator` only has
 *  `masters`/`productEditionFeatures` — this backfills the SKU/BOM/BOQ/audit-log
 *  collections added in Phase 2+3 without touching those two existing fields. */
function toV9(data: SnapshotShape): SnapshotShape {
  const existing = (data.commercialCalculator && typeof data.commercialCalculator === 'object' && !Array.isArray(data.commercialCalculator))
    ? data.commercialCalculator as Record<string, unknown>
    : {}
  const defaults = buildDefaultCommercialCalculatorData()
  return {
    ...data,
    commercialCalculator: {
      masters: existing.masters ?? defaults.masters,
      productEditionFeatures: existing.productEditionFeatures ?? defaults.productEditionFeatures,
      commercialSkus: existing.commercialSkus ?? defaults.commercialSkus,
      commercialBomItems: existing.commercialBomItems ?? defaults.commercialBomItems,
      commercialBoqs: existing.commercialBoqs ?? defaults.commercialBoqs,
      commercialBoqLineItems: existing.commercialBoqLineItems ?? defaults.commercialBoqLineItems,
      commercialAuditLogs: existing.commercialAuditLogs ?? defaults.commercialAuditLogs,
      boqSequenceByYear: existing.boqSequenceByYear ?? defaults.boqSequenceByYear,
    },
  }
}

/** v9 → v10. Adds the `customers` collection. Always starts empty — no
 *  legacy snapshot has this field, so upgrading just backfills `[]`. */
function toV10(data: SnapshotShape): SnapshotShape {
  if (Array.isArray(data.customers)) return data
  return { ...data, customers: [] }
}

/** v10 → v11. See `SCHEMA_VERSION` doc comment. */
function toV11(data: SnapshotShape): SnapshotShape {
  const cc = (data.commercialCalculator && typeof data.commercialCalculator === 'object' && !Array.isArray(data.commercialCalculator))
    ? data.commercialCalculator as Record<string, unknown>
    : undefined
  if (!cc) return data
  const commercialSkus = asArray(cc.commercialSkus).map((sku) =>
    Array.isArray(sku.selectedPricingLevels) ? sku : { ...sku, selectedPricingLevels: [] },
  )
  return { ...data, commercialCalculator: { ...cc, commercialSkus } }
}

/** v11 → v12. See `SCHEMA_VERSION` doc comment. */
function toV12(data: SnapshotShape): SnapshotShape {
  const cc = (data.commercialCalculator && typeof data.commercialCalculator === 'object' && !Array.isArray(data.commercialCalculator))
    ? data.commercialCalculator as Record<string, unknown>
    : undefined
  if (!cc) return data
  const commercialBoqLineItems = asArray(cc.commercialBoqLineItems).map((li) =>
    Array.isArray(li.pricingLevels) ? li : { ...li, pricingLevels: [], activePricingLevel: li.activePricingLevel ?? null },
  )
  return { ...data, commercialCalculator: { ...cc, commercialBoqLineItems } }
}

/** v12 → v13. See `SCHEMA_VERSION` doc comment. Each collection is backfilled
 *  only if missing/not-an-array — idempotent against a snapshot that somehow
 *  already has one (shouldn't happen pre-v13, same defensiveness as v10). */
function toV13(data: SnapshotShape): SnapshotShape {
  const withDefault = (key: string) => (Array.isArray(data[key]) ? data[key] : [])
  return {
    ...data,
    bids: withDefault('bids'),
    bidMilestones: withDefault('bidMilestones'),
    bidCorrigenda: withDefault('bidCorrigenda'),
    bidCorrigendumChanges: withDefault('bidCorrigendumChanges'),
    protectedValues: withDefault('protectedValues'),
    bidDocuments: withDefault('bidDocuments'),
    documentCitations: withDefault('documentCitations'),
    bidSavedViews: withDefault('bidSavedViews'),
  }
}

/** v14 → v15. See `SCHEMA_VERSION` doc comment. A column that already has
 *  a flag keeps it; otherwise it is true iff value rows exist today (a column
 *  whose values were cleared earlier is indistinguishable from a never-used
 *  one in a local snapshot, and stays deletable — the same limit as the API
 *  backfill without audit history). */
function toV15(data: SnapshotShape): SnapshotShape {
  const fields = asArray(data.bidCustomFields)
  const withValues = new Set(asArray(data.bidCustomFieldValues).map((v) => v.fieldId))
  return {
    ...data,
    bidCustomFields: fields.map((f) => ({
      ...f,
      hasHeldValue: typeof f.hasHeldValue === 'boolean' ? f.hasHeldValue : withValues.has(f.id),
    })),
  }
}

function toV16(data: SnapshotShape): SnapshotShape {
  const opportunities = asArray(data.opportunities).map((opportunity) => ({
    ...opportunity,
    geoSalesPersonId: opportunity.geoSalesPersonId ?? null,
    buSalesPersonId: opportunity.buSalesPersonId ?? null,
    preSalesPersonId: opportunity.preSalesPersonId ?? null,
    legalPersonId: opportunity.legalPersonId ?? null,
    bidTeamMemberId: opportunity.bidTeamMemberId ?? null,
  }))
  return { ...data, opportunities, deliveryTeamMembers: Array.isArray(data.deliveryTeamMembers) ? data.deliveryTeamMembers : [] }
}

/** v16 → v17. See `SCHEMA_VERSION` doc comment. */
function toV17(data: SnapshotShape): SnapshotShape {
  const deliveryTeamMembers = asArray(data.deliveryTeamMembers).map((member) => ({ ...member, managerId: member.managerId ?? null }))
  return { ...data, deliveryTeamMembers }
}

/** v17 → v18. See `SCHEMA_VERSION` doc comment. */
function toV18(data: SnapshotShape): SnapshotShape {
  const backfilled = asArray(data.deliveryTeamMembers).map((member) => ({ ...member, designation: member.designation ?? '' }))
  return { ...data, deliveryTeamMembers: mergeTeamRosters(backfilled as unknown as DeliveryTeamMember[]) }
}

/** v20 → v21. See `SCHEMA_VERSION` doc comment. */
function toV21(data: SnapshotShape): SnapshotShape {
  const orgPeople = mergeOrgSeed(asArray(data.orgPeople) as unknown as OrgPerson[])
  const members = asArray(data.deliveryTeamMembers) as unknown as DeliveryTeamMember[]
  return { ...data, orgPeople, deliveryTeamMembers: syncAllTeamsFromOrg(orgPeople, members) }
}

/** v18 → v19. See `SCHEMA_VERSION` doc comment. */
function toV19(data: SnapshotShape): SnapshotShape {
  return { ...data, deliveryTeamMembers: mergeTeamRosters(asArray(data.deliveryTeamMembers) as unknown as DeliveryTeamMember[]) }
}

/** v19 → v20. See `SCHEMA_VERSION` doc comment. Idempotent: only code-less rows are touched. */
function toV20(data: SnapshotShape): SnapshotShape {
  const withType = asArray(data.opportunities).map((o) => ({ ...o, opportunityType: typeof o.opportunityType === 'string' ? o.opportunityType : '' }))
  const sequences = (data.opportunityCodeSequences && typeof data.opportunityCodeSequences === 'object'
    ? data.opportunityCodeSequences : {}) as Record<string, number>
  const { opportunities, sequences: next } = assignMissingOpportunityCodes(
    withType as unknown as Opportunity[], asArray(data.nodes) as unknown as HierNode[], sequences,
  )
  return { ...data, opportunities, opportunityCodeSequences: next }
}

/** v13 → v14. See `SCHEMA_VERSION` doc comment. Idempotent for the same
 *  reason as v13. */
function toV14(data: SnapshotShape): SnapshotShape {
  const withDefault = (key: string) => (Array.isArray(data[key]) ? data[key] : [])
  return {
    ...data,
    bidCustomFields: withDefault('bidCustomFields'),
    bidCustomFieldValues: withDefault('bidCustomFieldValues'),
  }
}

/** Keyed by the version each step PRODUCES, so applying every key from
 *  `fromVersion + 1` up to `SCHEMA_VERSION` walks the chain in order. */
export const MIGRATIONS: Record<number, (data: SnapshotShape) => SnapshotShape> = {
  2: toV2,
  3: toV3,
  4: toV4,
  5: toV5,
  6: toV6,
  7: toV7,
  8: toV8,
  9: toV9,
  10: toV10,
  11: toV11,
  12: toV12,
  13: toV13,
  14: toV14,
  15: toV15,
  16: toV16,
  17: toV17,
  18: toV18,
  19: toV19,
  20: toV20,
  21: toV21,
}

/** Upgrades a stored snapshot to `SCHEMA_VERSION`.
 *
 *  Returns `null` when the snapshot cannot be migrated — a version from a
 *  newer build (we cannot downgrade), a nonsensical version, a non-object
 *  payload, or a step that throws. The caller falls back to seed data,
 *  which is the same outcome as the old discard behavior but now reserved
 *  for genuinely unrecoverable input rather than every schema bump. */
export function migrateSnapshot(raw: unknown, fromVersion: number): GormsData | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!Number.isInteger(fromVersion) || fromVersion < 1) return null
  if (fromVersion > SCHEMA_VERSION) return null

  let data = raw as SnapshotShape
  try {
    for (let v = fromVersion + 1; v <= SCHEMA_VERSION; v++) {
      const step = MIGRATIONS[v]
      if (!step) return null
      data = step(data)
    }
  } catch {
    return null
  }
  return data as unknown as GormsData
}
