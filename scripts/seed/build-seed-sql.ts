import { NODE_TYPE_MAP } from '../../src/lib/node-types'
import { uid } from '../../src/lib/utils'
import { insertStatement, sqlTextArray, sqlVal } from './sql-utils'
import { buildGovHierarchy } from '../../src/data/gov-hierarchy'
import type { HierNode, Employee } from '../../src/lib/types'
import indiaAdmin from '../../src/data/india-admin.json'
import subdistricts from '../../src/data/subdistricts.json'

interface IndiaAdminDistrict { dt_code: string; district: string }
interface IndiaAdminState { st_code: string; st_nm: string; districts: IndiaAdminDistrict[] }
interface Subdistrict { code: string; name: string; dtCode: string; stCode: number; villageCount: number }

function buildNodeTypesSection(): string {
  const rows = Object.values(NODE_TYPE_MAP).map((t) => [
    t.key, t.domain, t.label, t.icon, t.level,
  ])
  let sql = '-- node_types\n'
  sql += insertStatement('node_types', ['key', 'domain', 'label', 'icon', 'level'], rows)
  // child_keys needs the array literal helper, not the scalar insertStatement path.
  for (const t of Object.values(NODE_TYPE_MAP)) {
    sql += `update public.node_types set child_keys = ${sqlTextArray(t.childKeys)} where key = '${t.key}';\n`
  }
  return sql
}

function buildGeoNodesSection(): { sql: string; countryId: string; stateIdByCode: Map<number, string> } {
  const countryId = uid('geo')
  const stateIdByCode = new Map<number, string>()
  const districtIdByCode = new Map<string, string>()

  const nodeRows: (string | number | null)[][] = []
  nodeRows.push([countryId, null, 'country', null, 'India', null, null, 0])

  const admin = indiaAdmin as IndiaAdminState[]
  admin.forEach((state, stateIdx) => {
    const stateCode = Number(state.st_code)
    const stateId = uid('geo')
    stateIdByCode.set(stateCode, stateId)
    nodeRows.push([stateId, countryId, 'state', stateCode, state.st_nm, state.st_code, state.st_code, stateIdx])

    state.districts.forEach((district, districtIdx) => {
      const districtId = uid('geo')
      districtIdByCode.set(district.dt_code, districtId)
      nodeRows.push([districtId, stateId, 'district', stateCode, district.district, district.dt_code, district.dt_code, districtIdx])
    })
  })

  const subs = subdistricts as Subdistrict[]
  subs.forEach((sub, idx) => {
    const districtId = districtIdByCode.get(sub.dtCode)
    if (!districtId) return // subdistrict references a district not present in india-admin.json — skip, don't fabricate a parent
    const talukaId = uid('geo')
    nodeRows.push([talukaId, districtId, 'taluka', sub.stCode, sub.name, sub.code, sub.code, idx])
  })

  const columns = ['id', 'parent_id', 'type_key', 'state_code', 'name', 'code', 'lgd_code', 'sort_order']
  const sql = '-- geo_nodes: country + all real states/districts/talukas\n' + insertStatement('geo_nodes', columns, nodeRows)
  return { sql, countryId, stateIdByCode }
}

function buildDepartmentsSection(nodes: HierNode[]): string {
  const orgNodes = nodes.filter((n) => n.domain === 'org')
  const rows = orgNodes.map((n) => [
    n.id, n.parentId, n.stateCode, n.typeKey, n.name, n.code, n.sortOrder, n.status,
  ])
  let sql = '-- departments (from gov-hierarchy.ts org tree)\n'
  sql += insertStatement(
    'departments',
    ['id', 'parent_id', 'state_code', 'type_key', 'name', 'code', 'sort_order', 'status'],
    rows,
  )
  for (const n of orgNodes) {
    if (Object.keys(n.metadata).length === 0) continue
    const json = JSON.stringify(n.metadata).replace(/'/g, "''")
    sql += `update public.departments set metadata = '${json}'::jsonb where id = '${n.id}';\n`
  }
  return sql
}

function buildEmployeesSection(employees: Employee[]): string {
  const rows = employees.map((e) => [
    e.orgNodeId, e.name, e.code, e.designation, e.email, e.phone, e.company, e.address, e.website,
    e.photoUrl, e.vacant, e.connected, e.relationshipStatus, e.relationshipQuality,
    e.relationshipType, e.introducedBy, e.importantContact, e.status,
  ])
  let sql = '-- employees (vacant government positions from gov-hierarchy.ts)\n'
  sql += insertStatement(
    'employees',
    [
      'department_id', 'name', 'code', 'designation', 'email', 'phone', 'company', 'address', 'website',
      'photo_url', 'vacant', 'connected', 'relationship_status', 'relationship_quality',
      'relationship_type', 'introduced_by', 'important_contact', 'status',
    ],
    rows,
  )
  for (const e of employees) {
    sql += `update public.employees set preferred_comm = ${sqlTextArray(e.preferredComm)} where code = ${sqlVal(e.code)};\n`
  }
  // manager_id: buildGovHierarchy() already resolves managerId to the manager's
  // source position-id (e.g. "org_central_0_pos0") before returning — it does not
  // (and cannot) know the real Postgres uuid assigned at insert time. Every
  // employee's `code` is deterministically `POS-<source-position-id>` (unique),
  // so re-derive the manager's code from managerId and join through it — this is
  // the exact resolution gov-hierarchy.ts already computed, just re-targeted at
  // real DB ids instead of source ids.
  sql += '\n-- resolve manager_id via the unique employees.code join (see comment above)\n'
  for (const e of employees) {
    if (!e.managerId) continue
    const managerCode = `POS-${e.managerId}`
    sql += `update public.employees set manager_id = (select id from public.employees where code = ${sqlVal(managerCode)}) where code = ${sqlVal(e.code)};\n`
  }
  return sql
}

async function main() {
  let out = '-- Generated by scripts/seed/build-seed-sql.ts — do not hand-edit. Re-run `npm run seed:generate`.\n\n'
  out += buildNodeTypesSection()
  out += '\n'
  out += buildGeoNodesSection().sql
  out += '\n'

  const admin = (indiaAdmin as { st_code: string; st_nm: string }[]).map((s) => ({
    st_code: Number(s.st_code), st_nm: s.st_nm,
  }))
  const { nodes, employees } = buildGovHierarchy(admin)
  out += buildDepartmentsSection(nodes)
  out += '\n'
  out += buildEmployeesSection(employees)

  process.stdout.write(out)
}

main()
