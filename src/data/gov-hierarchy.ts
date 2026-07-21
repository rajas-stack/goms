import type { Employee, ExternalId, HierNode } from '@/lib/types'

/** A named seat in a real organogram — becomes a vacant Employee (no
 *  fabricated name/email/phone; only the real designation is known).
 *  `managerRef` names another position's exact `title` string anywhere in
 *  the same build pass (even under a different org node) — resolved to a
 *  real managerId after the whole tree is built, since a manager position
 *  is often posted on an ancestor node rather than the same one. */
interface PositionSpec {
  title: string
  managerRef?: string
  notes?: string
}

/** One box in a reference-image organogram. `typeKey` reuses the app's
 *  existing generic org taxonomy (department/branch/division/office/unit)
 *  purely for icon/badge/nesting-depth/root-listing purposes — the real
 *  identity of the body is `name` (kept as a bare noun for `department`-typed
 *  nodes so the app's "Department of {name}" convention reads naturally;
 *  the full official name goes in `description`). */
interface OrgSpec {
  name: string
  code?: string
  typeKey: 'department' | 'branch' | 'division' | 'office' | 'unit'
  description?: string
  notes?: string
  website?: string
  positions?: PositionSpec[]
  children?: OrgSpec[]
}

interface BuildAccumulator {
  nodes: HierNode[]
  employees: Employee[]
  externalIds: ExternalId[]
}

const EMPTY_EMPLOYEE_DEFAULTS = {
  name: '', code: '', email: '', phone: '', photoUrl: null as string | null,
  connected: false as const,
  relationshipStatus: 'new' as const,
  relationshipQuality: 'neutral' as const,
  relationshipType: '', introducedBy: '', importantContact: false,
  preferredComm: '' as const,
  lastInteractionAt: null, followUpDate: null,
  charges: [], visitingCards: [], metadata: {},
  status: 'active' as const,
}

function buildOrgTree(
  spec: OrgSpec,
  parentId: string | null,
  stateCode: number,
  id: string,
  sortOrder: number,
  acc: BuildAccumulator,
  positionIndex: Map<string, string>,
  pendingManagers: { employeeId: string; managerRef: string }[],
): void {
  const metadata: Record<string, string> = {}
  if (spec.description) metadata.description = spec.description
  if (spec.notes) metadata.notes = spec.notes
  if (spec.website) metadata.website = spec.website

  acc.nodes.push({
    id, domain: 'org', typeKey: spec.typeKey, parentId, stateCode,
    name: spec.name, code: spec.code ?? null, sortOrder, metadata, status: 'active',
  })

  ;(spec.positions ?? []).forEach((p, i) => {
    const empId = `${id}_pos${i}`
    acc.employees.push({
      ...EMPTY_EMPLOYEE_DEFAULTS,
      id: empId,
      code: `POS-${empId}`,
      designation: p.title,
      orgNodeId: id,
      managerId: null,
      vacant: true,
      notes: p.notes ?? '',
    })
    positionIndex.set(p.title, empId)
    if (p.managerRef) pendingManagers.push({ employeeId: empId, managerRef: p.managerRef })
  })

  ;(spec.children ?? []).forEach((child, i) => {
    buildOrgTree(child, id, stateCode, `${id}_c${i}`, i, acc, positionIndex, pendingManagers)
  })
}

// --- Ministry of Statistics and Programme Implementation (MoSPI) ----------

const NSO_SPEC: OrgSpec = {
  name: 'National Statistics Office (NSO)', typeKey: 'branch', code: 'NSO',
  children: [
    {
      name: 'Director General (National Sample Survey)', typeKey: 'branch', code: 'NSO-NSS',
      notes: 'Historically the National Sample Survey Office (NSSO).',
      positions: [{ title: 'Director General (National Sample Survey)', managerRef: 'Secretary (MoSPI)' }],
      children: [
        { name: 'Household Survey Division', typeKey: 'office', code: 'NSO-01' },
        { name: 'Enterprise Survey Division', typeKey: 'office', code: 'NSO-02' },
        { name: 'Field Operations Division', typeKey: 'office', code: 'NSO-03' },
        { name: 'Coordination and Quality Control Division', typeKey: 'office', code: 'NSO-04' },
      ],
    },
    {
      name: 'Director General (Central Statistics)', typeKey: 'branch', code: 'NSO-CS',
      notes: 'Historically the Central Statistics Office (CSO).',
      positions: [{ title: 'Director General (Central Statistics)', managerRef: 'Secretary (MoSPI)' }],
      children: [
        { name: 'Economic Statistics Division', typeKey: 'office', code: 'NSO-05' },
        { name: 'National Accounts Division', typeKey: 'office', code: 'NSO-06' },
        { name: 'Social Statistics Division', typeKey: 'office', code: 'NSO-07' },
        { name: 'Price Statistics Division', typeKey: 'office', code: 'NSO-08' },
      ],
    },
    {
      name: 'Director General (Data Governance)', typeKey: 'branch', code: 'NSO-DG',
      positions: [{ title: 'Director General (Data Governance)', managerRef: 'Secretary (MoSPI)' }],
      children: [
        { name: 'Capacity Development Division & NSSTA', typeKey: 'office', code: 'NSO-09' },
        { name: 'Coordination & International Cooperation Unit', typeKey: 'office', code: 'NSO-10' },
        { name: 'Administrative Statistics and Policy Division', typeKey: 'office', code: 'NSO-11' },
        { name: 'Data Informatics and Innovation Division', typeKey: 'office', code: 'NSO-12' },
      ],
    },
    {
      name: 'Additional Secretary & Chief Vigilance Officer', typeKey: 'branch', code: 'NSO-CVO',
      positions: [{ title: 'Additional Secretary & Chief Vigilance Officer', managerRef: 'Secretary (MoSPI)' }],
      children: [
        { name: 'Indian Statistical Service Division', typeKey: 'office', code: 'NSO-13' },
        { name: 'Indian Statistical Institute Unit', typeKey: 'office', code: 'NSO-14' },
        { name: 'Research and Analysis Division', typeKey: 'office', code: 'NSO-15' },
        { name: 'Media & Publicity Unit', typeKey: 'office', code: 'NSO-16' },
        { name: 'Vigilance', typeKey: 'office', code: 'NSO-17' },
        {
          name: 'Members of Parliament Local Area Development Scheme (MPLADS)', typeKey: 'office', code: 'NSO-18',
          notes: 'Cross-referenced with the Programme Implementation Wing, which administers MPLADS.',
        },
      ],
    },
  ],
}

const PI_WING_SPEC: OrgSpec = {
  name: 'Programme Implementation (PI) Wing', typeKey: 'branch', code: 'PIW',
  children: [
    {
      name: 'Additional Secretary & Financial Advisor', typeKey: 'branch', code: 'PIW-FA',
      positions: [{ title: 'Additional Secretary & Financial Advisor', managerRef: 'Secretary (MoSPI)' }],
      children: [
        { name: 'Budget & Finance Division', typeKey: 'office', code: 'PIW-19' },
        { name: 'Controller of Accounts', typeKey: 'office', code: 'PIW-20' },
      ],
    },
    {
      name: 'Joint Secretary (PI Wing)', typeKey: 'branch', code: 'PIW-JS',
      positions: [{ title: 'Joint Secretary (PI Wing)', managerRef: 'Secretary (MoSPI)' }],
      children: [
        { name: 'Administration', typeKey: 'office', code: 'PIW-21' },
        {
          name: 'Subordinate Statistical Service Division', typeKey: 'office', code: 'PIW-22',
          notes: 'Through DG (Data Governance) — cross-referenced with the National Statistics Office.',
        },
        { name: 'Legal Cell', typeKey: 'office', code: 'PIW-23' },
        { name: 'State Unit', typeKey: 'office', code: 'PIW-24' },
        {
          name: 'Infrastructure and Project Monitoring Division (IPM)', typeKey: 'office', code: 'PIW-25',
          notes: 'Cross-referenced with the National Statistics Office. Also administers the Members of Parliament Local Area Development Scheme (MPLADS).',
        },
      ],
    },
    { name: 'Twenty Point Programme (TPP)', typeKey: 'office', code: 'PIW-TPP' },
  ],
}

// MoSPI is the org ROOT for this group (typeKey 'department', bare name) so
// it renders via the app's existing convention as "Department of Statistics
// and Programme Implementation" — the full official name lives in
// `description`, not `name` (see the OrgSpec doc comment above).
const MOSPI_SPEC: OrgSpec = {
  name: 'Statistics and Programme Implementation', typeKey: 'department', code: 'MOSPI',
  description: 'Ministry of Statistics and Programme Implementation (MoSPI). Operates under the Prime Minister & Council of Ministers, Government of India. Formed by merging the Department of Statistics and the Department of Programme Implementation; established 15 October 1999.',
  positions: [{ title: 'Secretary (MoSPI)' }],
  children: [
    {
      name: 'National Statistical Commission (NSC) Secretariat', typeKey: 'unit', code: 'NSC-SECT',
      notes: 'Created by a Resolution of the Government of India.',
    },
    {
      name: 'Indian Statistical Institute (Kolkata)', typeKey: 'unit', code: 'ISI',
      notes: 'Autonomous institute of national importance, established by an Act of Parliament.',
    },
    NSO_SPEC,
    PI_WING_SPEC,
  ],
}

// --- MeitY / IndiaAI, MoEFCC / CAQM, National Agencies, Industry Bodies ----

const MEITY_SPEC: OrgSpec = {
  name: 'Electronics and Information Technology', typeKey: 'department', code: 'MEITY',
  description: 'Ministry of Electronics & Information Technology (MeitY). Operates under the Prime Minister & Council of Ministers, Government of India.',
  children: [
    {
      name: 'National Informatics Centre (NIC)', typeKey: 'branch', code: 'NIC',
      children: [
        { name: 'National Informatics Centre Services Inc. (NICSI)', typeKey: 'division', code: 'NICSI' },
      ],
    },
    {
      name: 'Digital India Corporation (DIC)', typeKey: 'branch', code: 'DIC',
      children: [
        {
          name: 'IndiaAI Independent Business Division (IndiaAI Mission + INDIAai Portal)',
          typeKey: 'division', code: 'INDIAAI',
        },
      ],
    },
    { name: 'National e-Governance Division (NeGD)', typeKey: 'division', code: 'NEGD' },
  ],
}

const CAQM_SPEC: OrgSpec = {
  name: 'Commission for Air Quality Management (CAQM)', typeKey: 'branch', code: 'CAQM',
  positions: [
    { title: 'Chairperson (Full-time), CAQM' },
    { title: 'Member-Secretary (JS level), CAQM' },
    { title: 'Full-time Member, CAQM' },
  ],
  children: [
    {
      name: 'Independent Technical Members', typeKey: 'unit', code: 'CAQM-ITM',
      notes: 'Chief Secretaries / Environment Secretaries of Delhi, Punjab, Haryana, Rajasthan and Uttar Pradesh.',
    },
    {
      name: 'Ex-officio Members (States & Ministries)', typeKey: 'unit', code: 'CAQM-EOM',
      notes: 'Representatives from MoEFCC, the Ministry of Power, the Ministry of Petroleum & Natural Gas, and the CPCB.',
    },
    { name: 'Non-official Members (NGOs)', typeKey: 'unit', code: 'CAQM-NOM' },
    { name: 'CAQM Secretariat (Admin + Technical)', typeKey: 'unit', code: 'CAQM-SECT' },
  ],
}

const MOEFCC_SPEC: OrgSpec = {
  name: 'Environment, Forest and Climate Change', typeKey: 'department', code: 'MOEFCC',
  description: 'Ministry of Environment, Forest and Climate Change (MoEFCC). Operates under the Prime Minister & Council of Ministers, Government of India.',
  children: [CAQM_SPEC],
}

const NATIONAL_AGENCIES_SPEC: OrgSpec = {
  name: 'National Agencies', typeKey: 'department', code: 'NAT-AG',
  notes: 'Also includes the Ministry of Statistics and Programme Implementation (MoSPI) — see its full structure under its own department entry rather than duplicated here (a real org node can only have one parent/identity).',
  children: [
    { name: 'Bureau of Indian Standards (BIS)', typeKey: 'unit', code: 'BIS' },
    { name: 'SMART', typeKey: 'unit', code: 'SMART' },
    {
      name: 'MoSPI-SSD', typeKey: 'unit', code: 'MOSPI-SSD',
      notes: 'Subordinate Statistical Service Division — see also PIW-22 under the Programme Implementation Wing.',
    },
    { name: 'Airports Authority of India (AAI)', typeKey: 'unit', code: 'AAI' },
    { name: 'National Highways Authority of India (NHAI)', typeKey: 'unit', code: 'NHAI' },
    { name: 'Delhi-Mumbai Industrial Corridor (DMIC)', typeKey: 'unit', code: 'DMIC' },
  ],
}

const INDUSTRY_BODIES_SPEC: OrgSpec = {
  name: 'Industry Bodies', typeKey: 'department', code: 'IND-BODIES',
  children: [
    { name: 'National Association of Software and Service Companies (NASSCOM)', typeKey: 'unit', code: 'NASSCOM' },
  ],
}

// --- Group registry + builder entry point ---------------------------------

/** Reserved stateCode for the virtual "Government of India (Central)" geo
 *  node this plan adds in Task 5 — real LGD codes start at 1, and -1 is
 *  already reserved by the Directory's cross-state view. */
export const CENTRAL_STATE_CODE = 0

interface StateOrgGroup {
  /** Exact `st_nm` to resolve against the real admin dataset. `null` = the
   *  virtual Central Government state. */
  stateName: string | null
  specs: OrgSpec[]
}

// Task 4 appends Maharashtra and the other 8 named states to this array.
const GROUPS: StateOrgGroup[] = [
  { stateName: null, specs: [MOSPI_SPEC, MEITY_SPEC, MOEFCC_SPEC, NATIONAL_AGENCIES_SPEC, INDUSTRY_BODIES_SPEC] },
]

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export function buildGovHierarchy(admin: { st_code: number; st_nm: string }[]) {
  const acc: BuildAccumulator = { nodes: [], employees: [], externalIds: [] }
  const byName = new Map(admin.map((s) => [s.st_nm.trim().toLowerCase(), s.st_code] as const))

  for (const group of GROUPS) {
    const stateCode = group.stateName === null ? CENTRAL_STATE_CODE : byName.get(group.stateName.toLowerCase())
    if (stateCode === undefined) {
      // eslint-disable-next-line no-console
      console.warn(`gov-hierarchy: state "${group.stateName}" not found in admin data — skipped`)
      continue
    }
    const positionIndex = new Map<string, string>()
    const pendingManagers: { employeeId: string; managerRef: string }[] = []
    group.specs.forEach((spec, i) => {
      buildOrgTree(spec, null, stateCode, `org_${slug(group.stateName ?? 'central')}_${i}`, i, acc, positionIndex, pendingManagers)
    })
    for (const { employeeId, managerRef } of pendingManagers) {
      const mgrId = positionIndex.get(managerRef)
      if (!mgrId) continue
      const emp = acc.employees.find((e) => e.id === employeeId)
      if (emp) emp.managerId = mgrId
    }
  }
  return acc
}
