import type {
  Charge, Employee, ExternalId, HierNode, RelationshipQuality, TimelineEvent, Transfer,
} from '@/lib/types'
import { mulberry32, pick } from '@/lib/utils'
import adminRaw from './india-admin.json'
import deptsRaw from './departments-by-state.json'
import subdistrictsRaw from './subdistricts.json'

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
const deptsByState = deptsRaw as Record<string, string[]>

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

const FIRST = [
  'Aarav', 'Vivaan', 'Ananya', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Priya', 'Arjun', 'Sneha',
  'Vikram', 'Neha', 'Karthik', 'Divya', 'Sanjay', 'Pooja', 'Rahul', 'Anjali', 'Manish', 'Kavya',
  'Suresh', 'Lakshmi', 'Deepak', 'Ritu', 'Aditya', 'Nisha', 'Harsh', 'Isha', 'Naveen', 'Swati',
]
const LAST = [
  'Sharma', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Menon', 'Gupta', 'Rao', 'Verma', 'Desai',
  'Joshi', 'Pillai', 'Chowdhury', 'Banerjee', 'Kulkarni', 'Mehta', 'Singh', 'Das', 'Bhat', 'Naidu',
]
const HEAD = ['Director', 'Commissioner', 'Secretary', 'Chief Officer']
const DEPUTY = ['Deputy Director', 'Joint Director', 'Additional Secretary', 'Under Secretary']
const OFFICER = ['Section Officer', 'Inspector', 'Assistant Director', 'Field Officer']
const BRANCHES = ['Administration', 'Operations', 'Planning', 'Field Services', 'Records', 'Accounts']

const SHOWCASE = new Set([24, 27, 29, 9, 33]) // Gujarat, Maharashtra, Karnataka, UP, Tamil Nadu

export interface GormsData {
  nodes: HierNode[]
  employees: Employee[]
  externalIds: ExternalId[]
  timeline: TimelineEvent[]
  transfers: Transfer[]
}

const QUALITIES: RelationshipQuality[] = ['excellent', 'good', 'neutral', 'weak', 'poor']
const REL_TYPES = ['Colleague', 'Counterpart', 'Mentor', 'Alumnus', 'Political', 'Vendor']
const COMMS = ['phone', 'email', 'whatsapp', 'in-person'] as const

export function buildSeed(): GormsData {
  const nodes: HierNode[] = []
  const employees: Employee[] = []
  const externalIds: ExternalId[] = []
  const timeline: TimelineEvent[] = []
  const transfers: Transfer[] = []
  const rng = mulberry32(20260717)
  let empN = 0
  let evtN = 0

  const daysAgo = (n: number) => {
    // Deterministic dates relative to the seed's reference day (no Date.now,
    // so the demo dataset is byte-identical on every load).
    const base = Date.UTC(2026, 6, 17) - n * 86400000
    return new Date(base).toISOString().slice(0, 10)
  }
  const daysAhead = (n: number) => daysAgo(-n)

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

    // Organizational tree per state — departments as roots (jurisdictioned to the state)
    const depts = deptsByState[String(st.st_code)] ?? []
    const showcase = SHOWCASE.has(st.st_code)
    const deptCount = showcase ? Math.min(depts.length, 8) : depts.length

    depts.slice(0, deptCount).forEach((deptName, dpi) => {
      const deptId = `org_dep_${st.st_code}_${dpi}`
      nodes.push({
        id: deptId, domain: 'org', typeKey: 'department', parentId: null, stateCode: st.st_code,
        name: deptName, code: `DEP-${st.st_code}-${String(dpi + 1).padStart(2, '0')}`, sortOrder: dpi,
        metadata: { website: `https://${st.st_nm.toLowerCase().replace(/\s+/g, '')}.gov.in` }, status: 'active',
      })

      if (!showcase || dpi >= 6) return

      const branchCount = 2
      for (let b = 0; b < branchCount; b++) {
        const branchId = `${deptId}_br_${b}`
        nodes.push({
          id: branchId, domain: 'org', typeKey: 'branch', parentId: deptId, stateCode: st.st_code,
          name: `${pick(rng, BRANCHES)} Branch`, code: `BR-${st.st_code}-${dpi}-${b}`, sortOrder: b,
          metadata: {}, status: 'active',
        })

        for (let o = 0; o < 2; o++) {
          const officeId = `${branchId}_of_${o}`
          const district = pick(rng, st.districts)
          nodes.push({
            id: officeId, domain: 'org', typeKey: 'office', parentId: branchId, stateCode: st.st_code,
            name: `${district?.district ?? st.st_nm} Office`, code: `OF-${st.st_code}-${dpi}-${b}-${o}`,
            sortOrder: o, metadata: { location: district?.district ?? st.st_nm }, status: 'active',
          })

          // employees: head -> deputy -> officers
          const mkEmp = (
            role: 'head' | 'deputy' | 'officer',
            managerId: string | null,
            opts: { vacant?: boolean } = {},
          ): string => {
            empN += 1
            const vacant = opts.vacant ?? false
            const name = `${pick(rng, FIRST)} ${pick(rng, LAST)}`
            const id = `emp_${empN}`
            const designation =
              role === 'head' ? pick(rng, HEAD) : role === 'deputy' ? pick(rng, DEPUTY) : pick(rng, OFFICER)
            const connected = !vacant && rng() > 0.15
            const rs = pick(rng, ['engaged', 'developing', 'dormant', 'new'] as const)
            const rq = pick(rng, QUALITIES)
            const important = connected && (role === 'head' || rng() > 0.85)
            // Spread follow-ups across overdue / today / upcoming so the
            // analytics "due" bucket has realistic content.
            const hasFollowUp = connected && rng() > 0.6
            const followUpDate = hasFollowUp ? daysAhead(Math.floor(rng() * 14) - 4) : null
            const lastInteractionAt = connected && rng() > 0.4 ? daysAgo(Math.floor(rng() * 40) + 1) : null

            const charges: Charge[] = []
            if (role === 'head' && rng() > 0.7) {
              charges.push({
                id: `chg_${empN}_a`, kind: rng() > 0.5 ? 'additional' : 'acting',
                title: pick(rng, ['CEO Smart City', 'Election Officer', 'Nodal Officer (IT)', 'Project Director']),
                orgNodeId: deptId,
                startDate: daysAgo(Math.floor(rng() * 120) + 30),
                endDate: null, reason: 'Interim arrangement pending posting',
              })
            }

            employees.push({
              id, code: `EMP-${st.st_code}-${String(empN).padStart(4, '0')}`,
              name: vacant ? '' : name,
              designation,
              email: vacant ? '' : `${name.toLowerCase().replace(/\s+/g, '.')}@${st.st_nm.toLowerCase().replace(/\s+/g, '')}.gov.in`,
              phone: vacant ? '' : `+91 ${90000 + Math.floor(rng() * 9999)} ${10000 + Math.floor(rng() * 89999)}`,
              photoUrl: null,
              orgNodeId: officeId, managerId,
              vacant,
              connected,
              relationshipStatus: rs, relationshipQuality: rq,
              relationshipType: connected ? pick(rng, REL_TYPES) : '',
              introducedBy: '',
              importantContact: important,
              preferredComm: connected ? pick(rng, COMMS as unknown as string[]) as Employee['preferredComm'] : '',
              lastInteractionAt, followUpDate, notes: '',
              charges,
              visitingCards: [],
              metadata: {},
              status: 'active',
            })
            externalIds.push({ entityType: 'employee', entityId: id, system: 'HRMS', value: `H${100000 + empN}` })

            if (!vacant) {
              evtN += 1
              timeline.push({
                id: `evt_${evtN}`, employeeId: id, type: 'joined',
                title: `Joined as ${designation}`, date: daysAgo(Math.floor(rng() * 900) + 120),
                note: '', source: 'system',
              })
              if (lastInteractionAt) {
                evtN += 1
                timeline.push({
                  id: `evt_${evtN}`, employeeId: id,
                  type: pick(rng, ['meeting', 'call', 'email', 'whatsapp'] as const),
                  title: pick(rng, ['Coordination meeting', 'Follow-up call', 'Email exchange', 'Quick sync']),
                  date: lastInteractionAt, note: '', source: 'manual',
                })
              }
            }
            return id
          }
          // Leave one officer seat vacant in every other office to showcase
          // vacant-position handling.
          const vacantSeat = o % 2 === 1
          const headId = mkEmp('head', null)
          const deputyId = mkEmp('deputy', headId)
          mkEmp('officer', deputyId)
          mkEmp('officer', deputyId, { vacant: vacantSeat })
        }
      }
    })
  })

  // A couple of demonstrative transfers on the first showcase state so the
  // "transferred officers" search and transfer history have real content.
  const transferable = employees.filter((e) => !e.vacant && e.designation && SHOWCASE.has(nodeState(nodes, e.orgNodeId)))
  transferable.slice(0, 6).forEach((emp, i) => {
    const office = nodes.find((n) => n.id === emp.orgNodeId)
    evtN += 1
    const t: Transfer = {
      id: `tr_${i + 1}`, employeeId: emp.id,
      fromDesignation: emp.designation, toDesignation: emp.designation,
      fromDepartmentName: 'Previous Department', toDepartmentName: 'Current Department',
      fromOfficeName: 'Previous Office', toOfficeName: office?.name ?? 'Current Office',
      toOrgNodeId: emp.orgNodeId,
      fromManagerName: '—', toManagerName: '—',
      effectiveDate: daysAgo(180 + i * 20), reason: 'Administrative transfer', remarks: '',
    }
    transfers.push(t)
    timeline.push({
      id: `evt_${evtN}`, employeeId: emp.id, type: 'transferred',
      title: `Transferred to ${t.toOfficeName}`, date: t.effectiveDate,
      note: t.reason, source: 'system',
    })
  })

  return { nodes, employees, externalIds, timeline, transfers }
}

/** state LGD code an org node sits under (via its own stateCode). */
function nodeState(nodes: HierNode[], orgNodeId: string): number {
  return nodes.find((n) => n.id === orgNodeId)?.stateCode ?? -1
}
