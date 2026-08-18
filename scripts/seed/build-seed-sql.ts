import { NODE_TYPE_MAP } from '../../src/lib/node-types'
import { uid } from '../../src/lib/utils'
import { insertStatement, sqlTextArray, sqlVal } from './sql-utils'
import { buildGovHierarchy } from '../../src/data/gov-hierarchy'
import type { HierNode, Employee } from '../../src/lib/types'
import { SALES_TIERS } from '../../src/data/sales-tiers'
import { buildSalesRoster } from '../../src/data/sales-roster-seed'
import {
  VERTICALS, PRODUCTS, MODULES, FEATURES, PRE_SALES, SKU_CATEGORIES, UNITS_OF_MEASURE,
  PRODUCT_EDITIONS, BILLING_TYPES, TAX_CLASSES, APPROVAL_MATRIX, CURRENCIES, SAMPLE_SKUS,
} from '../../src/modules/commercial-calculator/seed-defaults'
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

function buildSalesTiersSection(): string {
  const rows = SALES_TIERS.map((t) => [t.key, t.label, t.rank, t.active])
  return '-- sales_tiers\n' + insertStatement('sales_tiers', ['key', 'label', 'rank', 'active'], rows)
}

function buildSalesPeopleSection(): string {
  const { salesPersons, salesPostings } = buildSalesRoster()
  // The in-memory ids from buildSalesRoster() (uid('sp')/uid('spost')) are not
  // reused as Postgres uuids — sales_people.id is a generated uuid (per the
  // Global Constraints table-id convention). Every insert/join below goes
  // through the stable, real official_email unique key instead — exactly as
  // sales-roster-seed.ts's own comment describes email as "the join key that
  // predates this table" — rather than a fragile parallel id-remapping table.
  let sql = '-- sales_people (from SALES_TEAM roster)\n'
  for (const p of salesPersons) {
    sql += `insert into public.sales_people (id, employee_code, name, official_email, personal_email, mobile, alt_mobile, status, notes) values (gen_random_uuid(), ${sqlVal(p.employeeCode)}, ${sqlVal(p.name)}, ${sqlVal(p.officialEmail)}, ${sqlVal(p.personalEmail)}, ${sqlVal(p.mobile)}, ${sqlVal(p.altMobile)}, ${sqlVal(p.status)}, ${sqlVal(p.notes)});\n`
  }
  sql += '\n-- sales_postings (initial posting per person, resolved by official_email join, not by the discarded in-memory id)\n'
  for (const posting of salesPostings) {
    const person = salesPersons.find((p) => p.id === posting.salesPersonId)!
    const manager = posting.managerId ? salesPersons.find((p) => p.id === posting.managerId) : null
    sql += `insert into public.sales_postings (sales_person_id, designation, tier_key, manager_id, change_type, reason) select sp.id, ${sqlVal(posting.designation)}, ${sqlVal(posting.tierKey)}, ${manager ? `(select id from public.sales_people where official_email = ${sqlVal(manager.officialEmail)})` : 'NULL'}, ${sqlVal(posting.changeType)}, ${sqlVal(posting.reason)} from public.sales_people sp where sp.official_email = ${sqlVal(person.officialEmail)};\n`
  }
  return sql
}

function masterBaseCols() { return ['code', 'name', 'description', 'active', 'display_order'] as const }
function masterBaseVals(r: { code: string; name: string; description: string; active: boolean; displayOrder: number }) {
  return [r.code, r.name, r.description, r.active, r.displayOrder]
}

function buildCommercialMastersSection(): string {
  let sql = '-- commercial_verticals\n'
  sql += insertStatement('commercial_verticals', [...masterBaseCols()], VERTICALS.map(masterBaseVals))

  sql += '\n-- commercial_products (vertical_id resolved by vertical code)\n'
  for (const p of PRODUCTS) {
    const vertical = VERTICALS.find((v) => v.id === p.verticalId)!
    sql += `insert into public.commercial_products (code, name, description, active, display_order, vertical_id) select ${sqlVal(p.code)}, ${sqlVal(p.name)}, ${sqlVal(p.description)}, ${sqlVal(p.active)}, ${sqlVal(p.displayOrder)}, id from public.commercial_verticals where code = ${sqlVal(vertical.code)};\n`
  }

  sql += '\n-- commercial_modules (product_id resolved by product code)\n'
  for (const m of MODULES) {
    const product = PRODUCTS.find((p) => p.id === m.productId)!
    sql += `insert into public.commercial_modules (code, name, description, active, display_order, product_id) select ${sqlVal(m.code)}, ${sqlVal(m.name)}, ${sqlVal(m.description)}, ${sqlVal(m.active)}, ${sqlVal(m.displayOrder)}, id from public.commercial_products where code = ${sqlVal(product.code)};\n`
  }

  sql += '\n-- commercial_features (module_id resolved by module code)\n'
  for (const f of FEATURES) {
    const mod = MODULES.find((m) => m.id === f.moduleId)!
    sql += `insert into public.commercial_features (code, name, description, active, display_order, module_id, status) select ${sqlVal(f.code)}, ${sqlVal(f.name)}, ${sqlVal(f.description)}, ${sqlVal(f.active)}, ${sqlVal(f.displayOrder)}, id, ${sqlVal(f.status)} from public.commercial_modules where code = ${sqlVal(mod.code)};\n`
  }

  sql += '\n-- flat masters (no parent FK)\n'
  sql += insertStatement('commercial_sku_categories', [...masterBaseCols()], SKU_CATEGORIES.map(masterBaseVals))
  sql += insertStatement('commercial_units_of_measure', [...masterBaseCols()], UNITS_OF_MEASURE.map(masterBaseVals))
  sql += insertStatement('commercial_product_editions', [...masterBaseCols()], PRODUCT_EDITIONS.map(masterBaseVals))
  sql += insertStatement('commercial_billing_types', [...masterBaseCols()], BILLING_TYPES.map(masterBaseVals))
  sql += insertStatement('commercial_pre_sales', [...masterBaseCols()], PRE_SALES.map(masterBaseVals))

  sql += '\n-- commercial_tax_classes\n'
  sql += insertStatement('commercial_tax_classes', [...masterBaseCols(), 'rate_pct'], TAX_CLASSES.map((r) => [...masterBaseVals(r), r.ratePct]))

  sql += '\n-- commercial_approval_matrix\n'
  sql += insertStatement(
    'commercial_approval_matrix',
    [...masterBaseCols(), 'min_discount_pct', 'max_discount_pct', 'approval_level_label', 'allow_auto_approval'],
    APPROVAL_MATRIX.map((r) => [...masterBaseVals(r), r.minDiscountPct, r.maxDiscountPct, r.approvalLevelLabel, r.allowAutoApproval]),
  )

  sql += '\n-- commercial_currencies\n'
  sql += insertStatement(
    'commercial_currencies',
    [...masterBaseCols(), 'symbol', 'decimal_places', 'exchange_rate', 'is_base_currency'],
    CURRENCIES.map((r) => [...masterBaseVals(r), r.symbol, r.decimalPlaces, r.exchangeRate, r.isBaseCurrency]),
  )

  return sql
}

function buildSampleSkusSection(): string {
  let sql = "\n-- commercial_skus (sample, resolved by each FK master's code)\n"
  for (const s of SAMPLE_SKUS) {
    const category = SKU_CATEGORIES.find((c) => c.id === s.categoryId)!
    const feature = FEATURES.find((f) => f.id === s.featureId)!
    const edition = PRODUCT_EDITIONS.find((e) => e.id === s.editionId)!
    const uom = UNITS_OF_MEASURE.find((u) => u.id === s.uomId)!
    const currency = CURRENCIES.find((c) => c.id === s.currencyId)!
    const taxClass = TAX_CLASSES.find((t) => t.id === s.taxClassId)!
    const billingType = BILLING_TYPES.find((b) => b.id === s.billingTypeId)!
    sql += `insert into public.commercial_skus (
      sku_code, name, category_id, feature_id, edition_id, uom_id, currency_id, tax_class_id, billing_type_id,
      active_from, active_till, lifecycle_status, is_sellable, display_order,
      base_software_cost, implementation_cost_per_mm, integration_cost, third_party_cost, hardware_cost, cloud_cost, support_cost, training_cost,
      internal_price, floor_price, partner_price, government_price, enterprise_price, corporate_price, list_price,
      minimum_allowed_price, maximum_discount_percent
    ) select
      ${sqlVal(s.skuCode)}, ${sqlVal(s.name)},
      (select id from public.commercial_sku_categories where code = ${sqlVal(category.code)}),
      (select id from public.commercial_features where code = ${sqlVal(feature.code)}),
      (select id from public.commercial_product_editions where code = ${sqlVal(edition.code)}),
      (select id from public.commercial_units_of_measure where code = ${sqlVal(uom.code)}),
      (select id from public.commercial_currencies where code = ${sqlVal(currency.code)}),
      (select id from public.commercial_tax_classes where code = ${sqlVal(taxClass.code)}),
      (select id from public.commercial_billing_types where code = ${sqlVal(billingType.code)}),
      ${sqlVal(s.activeFrom)}, ${sqlVal(s.activeTill)}, ${sqlVal(s.lifecycleStatus)}, ${sqlVal(s.isSellable)}, ${sqlVal(s.displayOrder)},
      ${sqlVal(s.baseSoftwareCost)}, ${sqlVal(s.implementationCostPerMM)}, ${sqlVal(s.integrationCost)}, ${sqlVal(s.thirdPartyCost)}, ${sqlVal(s.hardwareCost)}, ${sqlVal(s.cloudCost)}, ${sqlVal(s.supportCost)}, ${sqlVal(s.trainingCost)},
      ${sqlVal(s.internalPrice)}, ${sqlVal(s.floorPrice)}, ${sqlVal(s.partnerPrice)}, ${sqlVal(s.governmentPrice)}, ${sqlVal(s.enterprisePrice)}, ${sqlVal(s.corporatePrice)}, ${sqlVal(s.listPrice)},
      ${sqlVal(s.minimumAllowedPrice)}, ${sqlVal(s.maximumDiscountPercent)};\n`
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
  out += '\n'

  out += buildSalesTiersSection()
  out += '\n'
  out += buildSalesPeopleSection()
  out += '\n'

  out += buildCommercialMastersSection()
  out += buildSampleSkusSection()

  process.stdout.write(out)
}

main()
