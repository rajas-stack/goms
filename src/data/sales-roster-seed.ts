import { uid } from '@/lib/utils'
import { SALES_TEAM } from './sales-team'
import { tierKeyFromDesignation } from './sales-tiers'
import type { SalesPerson, SalesPosting } from '@/lib/types'

/** Builds the initial sales roster from the hard-coded `SALES_TEAM` constant.
 *
 *  Shared by `buildSeed()` (fresh install — migrations never run there) and the
 *  v4 migration (existing snapshot). Duplicating it would let the two paths
 *  drift, and a fresh install would then disagree with an upgraded one.
 *
 *  Three shape changes happen here:
 *   - email → id. `officialEmail` is retained as the join key so email-keyed
 *     data (an Opportunity's `salesPersonEmail`, a department's
 *     `relationshipOwner`) still resolves until Phase 3 rewrites those to ids.
 *   - `reportsTo` (email) → `managerId` (SalesPerson.id).
 *   - designation / `tiers` → one `tierKey` on an `initial` posting.
 *
 *  Everyone gets exactly one open posting. Their real posting history predates
 *  this table and is unknown; inventing promotions would put fabricated
 *  intervals into the substrate the org chart and history ledger read.
 *  `startDate` is '' rather than a guessed join date, so unknown stays
 *  visibly unknown. */
export function buildSalesRoster(): { salesPersons: SalesPerson[]; salesPostings: SalesPosting[] } {
  const salesPersons: SalesPerson[] = []
  const salesPostings: SalesPosting[] = []
  const idByEmail = new Map<string, string>()

  // Two passes: every id must exist before any `reportsTo` is resolved, since
  // a manager can appear after their report in the source array.
  for (const m of SALES_TEAM) {
    const id = uid('sp')
    idByEmail.set(m.email, id)
    salesPersons.push({
      id,
      employeeCode: '',
      name: m.name,
      officialEmail: m.email,
      personalEmail: '',
      mobile: '',
      altMobile: '',
      joinedOn: null,
      leftOn: null,
      status: 'active',
      notes: '',
      metadata: {},
      createdAt: '',
      createdBy: null,
    })
  }

  for (const m of SALES_TEAM) {
    // `tiers` is an explicit override for ambiguous titles ('Regional Manager &
    // Head'); its first entry is the senior rung the person actually holds.
    const tierKey = m.tiers?.[0] ?? tierKeyFromDesignation(m.designation)
    salesPostings.push({
      id: uid('spost'),
      salesPersonId: idByEmail.get(m.email)!,
      designation: m.designation,
      tierKey,
      managerId: m.reportsTo ? idByEmail.get(m.reportsTo) ?? null : null,
      office: '',
      startDate: '',
      endDate: null,
      changeType: 'initial',
      reason: 'Seeded from the SALES_TEAM roster',
      createdAt: '',
      createdBy: null,
    })
  }

  return { salesPersons, salesPostings }
}
