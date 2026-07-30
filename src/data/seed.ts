import type {
  Employee, ExternalId, FollowUp, HierNode, Opportunity, OpportunityStageChange, TimelineEvent, Transfer,
} from '@/lib/types'
import adminRaw from './india-admin.json'
import subdistrictsRaw from './subdistricts.json'
import { buildGovHierarchy, CENTRAL_STATE_CODE } from './gov-hierarchy'

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
        const sdId = `geo_sd_${sd.code}`
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

  return { nodes, employees, externalIds, timeline, transfers, opportunities, opportunityStageChanges, followUps }
}
