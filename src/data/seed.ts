import type {
  Customer, Employee, ExternalId, FollowUp, HierNode, MergeAuditRecord, Opportunity, OpportunityStageChange,
  OwnershipAssignment, SalesPerson, SalesPosting, TimelineEvent, Transfer,
} from '@/lib/types'
import adminRaw from './india-admin.json'
import subdistrictsRaw from './subdistricts.json'
import { buildGovHierarchy, CENTRAL_STATE_CODE } from './gov-hierarchy'
import { buildOwnershipFixture } from './ownership-fixture'
import { buildSalesRoster } from './sales-roster-seed'
import { buildDefaultCommercialCalculatorData } from '@/modules/commercial-calculator/seed-defaults'
import type { CommercialCalculatorData } from '@/modules/commercial-calculator/types'

interface AdminState {
  st_code: number
  st_nm: string
  districts: { dt_code: number; district: string }[]
}

interface RawAdminState {
  st_code: string
  st_nm: string
  districts: { dt_code: string | null; district: string }[]
}

const admin: AdminState[] = (adminRaw as unknown as RawAdminState[]).map((s) => ({
  st_code: Number(s.st_code),
  st_nm: s.st_nm,
  districts: s.districts.map((d, di) => ({
    dt_code: d.dt_code ? Number(d.dt_code) : Number(s.st_code) * 1000 + di,
    district: d.district,
  })),
}))

/** One entry per sub-district (taluka), matched by name to a current
 *  district's LGD code at build time — `dtCode` is the *target* app
 *  district's code, not the source LGD spreadsheet's own district code,
 *  which uses a different numbering. Villages are two orders of magnitude
 *  more numerous (~640k) than makes sense to hold as real nodes in this
 *  in-memory tree, so they're lazy-loaded per-taluka instead (see
 *  `features/geography/villages.ts`) and never appear here. */
interface RawSubdistrict {
  code: string
  name: string
  dtCode: string
  stCode: number
  villageCount: number
}
const subdistricts = subdistrictsRaw as RawSubdistrict[]
// The source LGD district-code numbering isn't actually unique nationwide —
// 11 pairs of unrelated districts in different states collide on the same
// `dt_code` (e.g. Gujarat's Gir Somnath and Tamil Nadu's Kallakurichi both
// use 729). Keying by state+district composite avoids stitching one state's
// talukas onto another's district.
function dtKey(stCode: number | string, dtCode: number | string): string {
  return `${stCode}_${dtCode}`
}
const subdistrictsByDtCode = new Map<string, RawSubdistrict[]>()
for (const sd of subdistricts) {
  const key = dtKey(sd.stCode, sd.dtCode)
  const list = subdistrictsByDtCode.get(key)
  if (list) list.push(sd)
  else subdistrictsByDtCode.set(key, [sd])
}

export interface GormsData {
  nodes: HierNode[]
  employees: Employee[]
  externalIds: ExternalId[]
  timeline: TimelineEvent[]
  transfers: Transfer[]
  opportunities: Opportunity[]
  opportunityStageChanges: OpportunityStageChange[]
  /** Added by Task 12. Declared here so `GormsData` matches the migrated
   *  snapshot shape; Task 12 adds the `FollowUp` type and the seed value. */
  followUps: FollowUp[]
  /** AMNEX sales roster. Populated by the v4 migration from `SALES_TEAM`. */
  salesPersons: SalesPerson[]
  salesPostings: SalesPosting[]
  ownershipAssignments: OwnershipAssignment[]
  mergeAudit: MergeAuditRecord[]
  /** The Commercial Calculator module's entire data slice. Added in v8 —
   *  see migrations.ts. Shape owned by src/modules/commercial-calculator/types.ts. */
  commercialCalculator: CommercialCalculatorData
  /** No seed fixture defined yet — starts empty. */
  customers: Customer[]
}

export function buildSeed(): GormsData {
  const nodes: HierNode[] = []
  const employees: Employee[] = []
  const externalIds: ExternalId[] = []
  const timeline: TimelineEvent[] = []
  const transfers: Transfer[] = []
  const opportunities: Opportunity[] = []
  const opportunityStageChanges: OpportunityStageChange[] = []
  const followUps: FollowUp[] = []
  // Same builder the v4 migration uses, so a fresh install and an upgraded
  // snapshot produce the same roster.
  const { salesPersons, salesPostings } = buildSalesRoster()
  const ownershipAssignments: OwnershipAssignment[] = []
  const mergeAudit: MergeAuditRecord[] = []
  const commercialCalculator = buildDefaultCommercialCalculatorData()

  const india: HierNode = {
    id: 'geo_india', domain: 'geo', typeKey: 'country', parentId: null, stateCode: null,
    name: 'India', code: 'IN', sortOrder: 0, metadata: { region: 'South Asia' }, status: 'active',
  }
  nodes.push(india)

  admin.forEach((st, si) => {
    const stateId = `geo_st_${st.st_code}`
    nodes.push({
      id: stateId, domain: 'geo', typeKey: 'state', parentId: india.id, stateCode: st.st_code,
      name: st.st_nm, code: String(st.st_code), sortOrder: si,
      metadata: { lgd_code: String(st.st_code) }, status: 'active',
    })
    externalIds.push({ entityType: 'geo_node', entityId: stateId, system: 'LGD', value: String(st.st_code) })

    st.districts.forEach((d, di) => {
      // Disambiguated with the state code — see the `dtKey` comment above.
      const dId = `geo_dt_${dtKey(st.st_code, d.dt_code)}`
      nodes.push({
        id: dId, domain: 'geo', typeKey: 'district', parentId: stateId, stateCode: st.st_code,
        name: d.district, code: String(d.dt_code), sortOrder: di,
        metadata: { lgd_code: String(d.dt_code) }, status: 'active',
      })
      externalIds.push({ entityType: 'geo_node', entityId: dId, system: 'LGD', value: String(d.dt_code) })

      const talukas = subdistrictsByDtCode.get(dtKey(st.st_code, d.dt_code)) ?? []
      talukas.forEach((sd, sdi) => {
        // Disambiguated with the state+district key, same reason as `dId`
        // above: `sd.code` (LGD subdistrict code) is only guaranteed unique
        // within a district, not nationally — a handful of talukas in
        // different states/districts reuse the same code (e.g. Odisha's
        // Barpali and Sikkim's Mangalbarey both carry code 7233).
        const sdId = `geo_sd_${dtKey(st.st_code, d.dt_code)}_${sd.code}`
        nodes.push({
          id: sdId, domain: 'geo', typeKey: 'taluka', parentId: dId, stateCode: st.st_code,
          name: sd.name, code: sd.code, sortOrder: sdi,
          metadata: { lgd_code: sd.code, villageCount: String(sd.villageCount) }, status: 'active',
        })
        externalIds.push({ entityType: 'geo_node', entityId: sdId, system: 'LGD', value: sd.code })
      })
    })

  })

  // Virtual geo entry for national/central-government bodies (MoSPI, MeitY,
  // CAQM, ...), which aren't scoped to any one state. Reserved stateCode 0 —
  // real LGD codes start at 1, and -1 is already the Directory's cross-state
  // sentinel. No district/taluka children: this is not a real place.
  nodes.push({
    id: `geo_st_${CENTRAL_STATE_CODE}`, domain: 'geo', typeKey: 'state', parentId: india.id,
    stateCode: CENTRAL_STATE_CODE, name: 'Central Ministries (Govt. of India)', code: String(CENTRAL_STATE_CODE),
    sortOrder: -1, metadata: {}, status: 'active',
  })

  const gov = buildGovHierarchy(admin)
  nodes.push(...gov.nodes)
  employees.push(...gov.employees)
  externalIds.push(...gov.externalIds)

  // --- QA test fixture -------------------------------------------------
  // A small, clearly-labeled sandbox department with two real (non-vacant,
  // connected) employees — every other seeded employee above is a vacant
  // government seat with no fabricated contact info, which makes hands-on
  // testing of manager-picking, transfer, search, and delete hard to
  // exercise without creating records first. These are ordinary records —
  // deletable via the normal Delete/Remove UI like anything else, nothing
  // protected about them.
  const qaDeptId = 'org_qa_test_department'
  nodes.push({
    id: qaDeptId, domain: 'org', typeKey: 'department', parentId: null,
    // Bare noun, not "... Department" — department-typed nodes render as
    // "Department of {name}" (see gov-hierarchy.ts's OrgSpec convention).
    stateCode: CENTRAL_STATE_CODE, name: 'QA Test', code: 'QATD',
    sortOrder: 9999, metadata: {}, status: 'active',
  })
  const qaManagerId = 'emp_qa_vikram_rao'
  const qaAnalystId = 'emp_qa_priya_nair'
  employees.push(
    {
      id: qaManagerId, code: 'QA-001', name: 'Vikram Rao', designation: 'Senior QA Manager',
      email: 'vikram.rao@example.com', phone: '+91 9876543210', company: '', address: '', website: '', photoUrl: null,
      orgNodeId: qaDeptId, managerId: null, vacant: false, connected: true,
      relationshipStatus: 'engaged', relationshipQuality: 'good', relationshipType: 'Test Contact',
      introducedBy: 'QA fixture', importantContact: true, preferredComm: ['email', 'phone'],
      lastInteractionAt: null, followUpDate: null, notes: 'Seed fixture for manual testing.',
      charges: [], visitingCards: [], metadata: {}, status: 'active',
    },
    {
      id: qaAnalystId, code: 'QA-002', name: 'Priya Nair', designation: 'QA Analyst',
      email: 'priya.nair@example.com', phone: '+91 9812345678', company: '', address: '', website: '', photoUrl: null,
      orgNodeId: qaDeptId, managerId: qaManagerId, vacant: false, connected: true,
      relationshipStatus: 'new', relationshipQuality: 'neutral', relationshipType: 'Test Contact',
      introducedBy: 'QA fixture', importantContact: false, preferredComm: ['phone', 'whatsapp'],
      lastInteractionAt: null, followUpDate: null, notes: 'Seed fixture for manual testing.',
      charges: [], visitingCards: [], metadata: {}, status: 'active',
    },
  )
  timeline.push(
    {
      id: 'evt_qa_join_vikram', employeeId: qaManagerId, type: 'joined',
      title: 'Contact created', date: '2026-01-05', note: '', source: 'system',
    },
    {
      id: 'evt_qa_join_priya', employeeId: qaAnalystId, type: 'joined',
      title: 'Contact created', date: '2026-01-06', note: '', source: 'system',
    },
    {
      id: 'evt_qa_meeting_priya', employeeId: qaAnalystId, type: 'meeting',
      title: 'QA Kickoff Meeting', date: '2026-01-10', time: '14:30',
      note: 'Discussed feature test coverage', source: 'manual', attendees: ['Mr. Rohit Tiku'],
    },
  )

  // Small labeled fixture so the ownership UI has something to show — see
  // ownership-fixture.ts for exactly which states it demonstrates.
  ownershipAssignments.push(...buildOwnershipFixture(nodes, salesPersons))

  // --- Commercial Calculator QA test fixture ----------------------------
  // `buildDefaultCommercialCalculatorData()` above seeds Verticals/Products
  // and the other reference masters, but leaves Modules, Features, Pre-Sales,
  // and the SKU catalog itself empty — by design, since those are meant to be
  // populated per-deployment, not hardcoded. That leaves Create BOQ's
  // cascading Vertical -> Product -> Module -> Feature picker with nothing to
  // resolve to, so hands-on testing means hand-building the whole hierarchy
  // plus real pricing before a single BOQ line can be added. These three
  // Module/Feature/SKU chains — one per Vertical, with realistic costs and
  // list prices — give that picker something real to walk end-to-end.
  // Ordinary rows: editable/deletable via the SKU Catalog UI like any other.
  commercialCalculator.masters.modules.push(
    { id: 'mod_qa_spotlock_core', code: 'CORE', name: 'Core Parking Management', description: 'QA fixture module.', active: true, displayOrder: 0, productId: 'prod_spotlock' },
    { id: 'mod_qa_locomate_eta', code: 'ETA', name: 'ETA Engine', description: 'QA fixture module.', active: true, displayOrder: 1, productId: 'prod_locomate' },
    { id: 'mod_qa_iion_hw', code: 'DEVICE', name: 'Smart Pole Hardware', description: 'QA fixture module.', active: true, displayOrder: 2, productId: 'prod_iion' },
  )
  commercialCalculator.masters.features.push(
    { id: 'feat_qa_slot_booking', code: 'SLOT', name: 'Slot Booking & Payment', description: 'QA fixture feature.', active: true, displayOrder: 0, moduleId: 'mod_qa_spotlock_core', status: 'new' },
    { id: 'feat_qa_vehicle_tracking', code: 'TRACK', name: 'Real-Time Vehicle Tracking', description: 'QA fixture feature.', active: true, displayOrder: 1, moduleId: 'mod_qa_locomate_eta', status: 'existing' },
    { id: 'feat_qa_pole_unit', code: 'POLE', name: 'Smart Pole Unit', description: 'QA fixture feature.', active: true, displayOrder: 2, moduleId: 'mod_qa_iion_hw', status: 'new' },
  )
  commercialCalculator.masters.preSales.push(
    { id: 'psl_qa_ananya', code: 'PS01', name: 'Ananya Verma', description: 'QA fixture pre-sales executive.', active: true, displayOrder: 0 },
    { id: 'psl_qa_karan', code: 'PS02', name: 'Karan Shah', description: 'QA fixture pre-sales executive.', active: true, displayOrder: 1 },
  )
  commercialCalculator.commercialSkus.push(
    {
      id: 'sku_qa_spotlock_slot', skuCode: 'SMARTCITY-SPOTLOCK-CORE-SLOT-NEW', name: 'Spotlock Slot Booking & Payment',
      categoryId: 'skc_software', featureId: 'feat_qa_slot_booking', editionId: 'ped_standard', uomId: 'uom_license',
      currencyId: 'cur_inr', taxClassId: 'tax_gst18', billingTypeId: 'bil_one_time',
      activeFrom: '2026-01-01', activeTill: null, lifecycleStatus: 'active', isSellable: true, displayOrder: 0,
      baseSoftwareCost: 40000, implementationCostPerMM: 15000, integrationCost: 5000, thirdPartyCost: 0,
      hardwareCost: 0, cloudCost: 3000, supportCost: 4000, trainingCost: 2000,
      internalPrice: 90000, floorPrice: 75000, partnerPrice: 95000, governmentPrice: 100000,
      enterprisePrice: 115000, corporatePrice: 110000, listPrice: 120000,
      minimumAllowedPrice: 75000, maximumDiscountPercent: 40,
      createdAt: '2026-01-01T00:00:00.000Z', createdBy: null, selectedPricingLevels: [],
    },
    {
      id: 'sku_qa_locomate_track', skuCode: 'TRANSIT-LOCOMATE-ETA-TRACK-EXG', name: 'Locomate Real-Time Vehicle Tracking',
      categoryId: 'skc_module', featureId: 'feat_qa_vehicle_tracking', editionId: 'ped_standard', uomId: 'uom_instance',
      currencyId: 'cur_inr', taxClassId: 'tax_gst18', billingTypeId: 'bil_subscription',
      activeFrom: '2026-01-01', activeTill: null, lifecycleStatus: 'active', isSellable: true, displayOrder: 1,
      baseSoftwareCost: 25000, implementationCostPerMM: 8000, integrationCost: 3000, thirdPartyCost: 0,
      hardwareCost: 0, cloudCost: 6000, supportCost: 3000, trainingCost: 1000,
      internalPrice: 55000, floorPrice: 48000, partnerPrice: 58000, governmentPrice: 62000,
      enterprisePrice: 70000, corporatePrice: 65000, listPrice: 75000,
      minimumAllowedPrice: 48000, maximumDiscountPercent: 35,
      createdAt: '2026-01-01T00:00:00.000Z', createdBy: null, selectedPricingLevels: [],
    },
    {
      id: 'sku_qa_iion_pole', skuCode: 'SMARTCITY-IION-DEVICE-POLE-NEW', name: 'IIon Smart Pole Unit',
      categoryId: 'skc_hardware', featureId: 'feat_qa_pole_unit', editionId: 'ped_standard', uomId: 'uom_device',
      currencyId: 'cur_inr', taxClassId: 'tax_gst12', billingTypeId: 'bil_one_time',
      activeFrom: '2026-01-01', activeTill: null, lifecycleStatus: 'active', isSellable: true, displayOrder: 2,
      baseSoftwareCost: 0, implementationCostPerMM: 2000, integrationCost: 1500, thirdPartyCost: 12000,
      hardwareCost: 35000, cloudCost: 0, supportCost: 2500, trainingCost: 500,
      internalPrice: 65000, floorPrice: 58000, partnerPrice: 68000, governmentPrice: 72000,
      enterprisePrice: 80000, corporatePrice: 75000, listPrice: 85000,
      minimumAllowedPrice: 58000, maximumDiscountPercent: 30,
      createdAt: '2026-01-01T00:00:00.000Z', createdBy: null, selectedPricingLevels: [],
    },
  )
  // One mandatory BOM link so the SKU BOM editor has a row to show/remove,
  // and so Create BOQ's margin preview (skuTotalUnitCostWithBom) has a
  // mandatory-component cost to actually roll up instead of always
  // matching the BOM-unaware total.
  commercialCalculator.commercialBomItems.push(
    {
      id: 'bom_qa_spotlock_needs_pole', parentSkuId: 'sku_qa_spotlock_slot', componentSkuId: 'sku_qa_iion_pole',
      mandatory: true, quantity: 1, notes: 'QA fixture: sensor hardware bundled with slot booking.',
    },
  )

  return {
    nodes, employees, externalIds, timeline, transfers,
    opportunities, opportunityStageChanges, followUps, salesPersons, salesPostings,
    ownershipAssignments, mergeAudit, commercialCalculator,
    customers: [],
  }
}
