/** Atoms only a `W` grant can hold; they are never placed in a partial set (spec §6.2). */
export const W_ONLY_ATOMS: readonly string[] = [
  'bid.stage', 'bid.verify', 'bid.archive', 'bid.move', 'opp.tenderId', 'opp.dates', 'opp.stage',
]

/** Atoms `W` does NOT imply: they are granted only by an explicit partial set, or by nobody.
 *  - sku.* / master.taxClasses / master.currencies: Finance-controlled commercial fields (spec §6.3).
 *  - boq.approve: BOQ approve/reject is CXO-only (spec §14.7).
 *  - ownership.solutionLead: Solution Lead is read-only for every role in v1 — no set contains it. */
export const EXCLUSIVE_ATOMS: ReadonlySet<string> = new Set([
  'sku.costs', 'sku.floor', 'sku.tax', 'master.taxClasses', 'master.currencies', 'boq.approve', 'ownership.solutionLead',
])

/** Atoms NO role can edit, System Admin included (spec §3.4, §6.2): Solution Lead is a data-integrity freeze — replacing
 *  a lead is two calls and only owners auto-close — not an access level. Every frozen atom is also exclusive. */
export const FROZEN_ATOMS: ReadonlySet<string> = new Set(['ownership.solutionLead'])

const ATOM_LABELS: Record<string, string> = {
  'opp.identity': 'the name, type, reference or tender link', 'opp.tenderId': 'the Tender ID', 'opp.client': 'the client, city or sector',
  'opp.value': 'the value fields', 'opp.emd': 'the EMD fields', 'opp.dates': 'the dates', 'opp.stage': 'the pipeline stage',
  'opp.teamSales': 'the Geo/BU-sales people', 'opp.teamDelivery': 'the Pre-sales / Legal / Bid people',
  'bid.stage': 'the bid stage', 'bid.decision': 'the Go / No-Go decision', 'bid.move': 'the sheet', 'bid.verify': 'data verification',
  'bid.archive': 'archiving', 'bid.nextAction': 'the next action', 'bid.custom': 'custom columns',
  'corrigendum.review': 'corrigendum review', 'doc.upload': 'tender documents', 'ownership.bidEntity': 'the bid owner',
  'ownership.assign': 'ownership', 'ownership.solutionLead': 'the Solution Lead (read-only)',
  'sales.ownProfile': 'your profile', 'sales.roster': 'the Sales Team roster',
  'sku.costs': 'SKU cost fields', 'sku.floor': 'SKU floor-price fields', 'sku.tax': 'the SKU tax class', 'sku.other': 'SKU details',
  'master.taxClasses': 'tax classes', 'master.currencies': 'currencies', 'master.other': 'reference masters',
  'boq.approve': 'BOQ approvals', 'boq.lines': 'BOQ lines',
}
export const atomLabel = (atom: string): string => ATOM_LABELS[atom] ?? atom

/** Keys the server accepts but ignores (an edit form echoes the locked Opportunity ID back). */
export const IGNORED_PATCH_KEYS: ReadonlySet<string> = new Set(['opportunityCode'])

/** `opportunities.update` patch keys → atoms (from `patchShape` in apps/api/src/routers/opportunities.ts). */
export const OPPORTUNITY_PATCH_ATOMS: Record<string, string> = {
  opportunityName: 'opp.identity', opportunityType: 'opp.identity', referenceNo: 'opp.identity', assignmentName: 'opp.identity',
  gemTenderId: 'opp.tenderId',
  departmentId: 'opp.client', stateCode: 'opp.client', city: 'opp.client', vertical: 'opp.client',
  valueAmount: 'opp.value', valueUnit: 'opp.value', currency: 'opp.value', budgetKnown: 'opp.value', quantity: 'opp.value', component: 'opp.value',
  emdAmount: 'opp.emd', emdUnit: 'opp.emd',
  publishDate: 'opp.dates', submissionDate: 'opp.dates', closedOn: 'opp.dates',
  stageKey: 'opp.stage',
  salesPersonEmail: 'opp.teamSales', geoSalesPersonId: 'opp.teamSales', buSalesPersonId: 'opp.teamSales',
  preSalesPersonId: 'opp.teamDelivery', legalPersonId: 'opp.teamDelivery', bidTeamMemberId: 'opp.teamDelivery',
}

/** `bids.update` patch keys → atoms. */
export const BID_PATCH_ATOMS: Record<string, string> = {
  stageKey: 'bid.stage', decision: 'bid.decision', tenderLink: 'opp.identity', sheet: 'bid.move',
}

/** `sales.update` patch keys: Sales may edit only photo, mobile and personal email on their own row. */
export function salesPersonPatchAtom(key: string): string {
  return key === 'photoUrl' || key === 'mobile' || key === 'personalEmail' ? 'sales.ownProfile' : 'sales.roster'
}

const SKU_COST_KEYS = new Set([
  'baseSoftwareCost', 'implementationCostPerMM', 'integrationCost', 'thirdPartyCost',
  'hardwareCost', 'cloudCost', 'supportCost', 'trainingCost',
])
const SKU_FLOOR_KEYS = new Set(['floorPrice', 'minimumAllowedPrice', 'internalPrice'])

/** `commercial.skus.update` patch keys → atoms. */
export function skuPatchAtom(key: string): string {
  if (SKU_COST_KEYS.has(key)) return 'sku.costs'
  if (SKU_FLOOR_KEYS.has(key)) return 'sku.floor'
  if (key === 'taxClassId') return 'sku.tax'
  return 'sku.other'
}

/** `commercial.masters.*` by master key. */
export function masterKeyAtom(key: string): string {
  if (key === 'taxClasses') return 'master.taxClasses'
  if (key === 'currencies') return 'master.currencies'
  return 'master.other'
}

/** `commercial.boq.updateLineItem` patch keys → atoms. */
export function lineItemPatchAtom(key: string): string {
  return key === 'approvalStatus' || key === 'approverId' || key === 'approvalDate' || key === 'approvalRemarks' ? 'boq.approve' : 'boq.lines'
}

/** Maps a patch object's keys to atoms. `undefined` from `resolve` ignores the key; `null` means the key has no
 *  atom (unknown/typo) and the whole patch must be denied. A non-object patch also returns `null`. */
export function atomsForPatch(patch: unknown, resolve: (key: string) => string | null | undefined): string[] | null {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return null
  const atoms = new Set<string>()
  for (const key of Object.keys(patch)) {
    const atom = resolve(key)
    if (atom === undefined) continue
    if (atom === null) return null
    atoms.add(atom)
  }
  return [...atoms]
}
