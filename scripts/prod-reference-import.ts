// Loads goms-dev's demo/reference dataset into a target environment through
// the Admin Data Import wizard's own tRPC procedures, instead of writing to
// Postgres directly.
//
// This reuses the *exact same* demo dataset scripts/seed-import.ts uses —
// buildSeed() and buildOwnershipFixture(), the same frontend seed builders —
// but where seed-import.ts remaps internal UUIDs and INSERTs rows straight
// into Postgres inside its own transaction, this script instead reshapes
// that data into the business-key-referencing spreadsheet-row shape the
// Admin Data Import feature (apps/api/src/import/) expects, and drives it
// through adminImportRouter's real validate/commit procedures over HTTP —
// the same pipeline a human admin clicking through the Settings -> Data
// Import wizard would exercise. That means every row gets the same
// zod validation, business-key dependency resolution, and transactional
// commit guarantees a real admin's upload gets; nothing here reimplements
// that logic.
//
// Run with (dry run, default and safe -- validates every domain, commits
// nothing):
//
//   API_BASE_URL=http://localhost:8080 npx tsx scripts/prod-reference-import.ts
//
// Add --commit to actually write, stopping at the first domain whose
// validate reports a reject or whose commit fails:
//
//   API_BASE_URL=http://localhost:8080 npx tsx scripts/prod-reference-import.ts --commit
//
// API_BASE_URL defaults to http://localhost:8080 (apps/api's local dev
// port). The Admin Data Import procedures are gated behind
// ADMIN_IMPORT_ENABLED=true on the server (apps/api/src/trpc.ts) -- unset in
// goms-prod today, so this script 404s against goms-prod until that gate is
// deliberately opened (see docs/superpowers/plans/2026-08-27-goms-prod-admin-import-enablement-plan.md).

import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../apps/api/src/index.js'
import { buildSeed } from '../src/data/seed.js'
import { buildOwnershipFixture } from '../src/data/ownership-fixture.js'

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8080'
const COMMIT = process.argv.includes('--commit')

const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `${API_BASE_URL}/api/trpc` })],
})

// A NOT-NULL-equivalent sentinel for the one field the demo dataset leaves
// genuinely unknown: every SalesPosting.startDate is '' ("unknown stays
// visibly unknown" -- src/data/sales-roster-seed.ts's own comment). Unlike
// seed-import.ts (a direct SQL insert, where a blank string is merely a
// NOT NULL violation to route around), the salesRoster import domain's own
// zod schema requires a real ISO date up front
// (apps/api/src/import/domains/salesRoster.ts's `startDate` regex) -- an
// empty string is a hard *reject*, not something that reaches commit at
// all. Reusing seed-import.ts's exact sentinel (same reasoning: no real
// AMNEX sales hire predates the company) rather than inventing a different
// one, so the two scripts agree on what "unknown join date" means.
const UNKNOWN_START_DATE_SENTINEL = '1970-01-01'

// ---------------------------------------------------------------------------
// small shared helpers
// ---------------------------------------------------------------------------

type Rows = unknown[] | Record<string, unknown[]>

function codeMapById(rows: { id: string; code: string }[]): Map<string, string> {
  return new Map(rows.map((r) => [r.id, r.code]))
}

function printSummary(label: string, summary: { toCreate: number; toUpdate: number; unchanged: number; rejected: number; total: number }) {
  console.log(`  ${label}: total=${summary.total} create=${summary.toCreate} update=${summary.toUpdate} unchanged=${summary.unchanged} reject=${summary.rejected}`)
}

/** Mirrors adminImport.ts's own per-domain `flatten` adapters -- most
 *  domains' preview is already a flat ImportRowResult[], but the 3
 *  multi-sheet domains (commercialMastersFlat/Catalog, salesRoster) return a
 *  { sheetName: rows[] } dict instead, which this collapses to one list so
 *  reject-row printing/counting doesn't need to special-case shape. */
function flattenPreview(domain: string, preview: any): any[] {
  if (domain === 'commercialMastersFlat') return Object.values(preview).flat()
  if (domain === 'commercialMastersCatalog') return [...preview.verticals, ...preview.products, ...preview.modules, ...preview.features]
  if (domain === 'salesRoster') return [...preview.persons, ...preview.postings]
  return preview
}

function printRejects(rows: any[]) {
  console.error(`  ${rows.length} rejected row(s):`)
  for (const r of rows.slice(0, 50)) {
    console.error(`    row ${r.rowNumber}${r.sheet ? ` [${r.sheet}]` : ''} (key="${r.businessKey}"): ${r.errors.join('; ')}`)
  }
  if (rows.length > 50) console.error(`    ... and ${rows.length - 50} more`)
}

/** Runs validate for one ordinary (non-geography) domain, printing its
 *  summary and (if any) its reject detail. In --commit mode, also commits
 *  immediately on a clean validate. Returns false on any reject or a commit
 *  failure -- never throws, so the caller can decide whether to stop. */
async function runDomain(domain: string, rows: Rows): Promise<boolean> {
  const { preview, summary, commitToken } = await (client as any).adminImport.validate.mutate({ domain, rows })
  printSummary(domain, summary)
  const flat = flattenPreview(domain, preview)
  const rejects = flat.filter((r) => r.action === 'reject')
  if (rejects.length > 0) {
    printRejects(rejects)
    return false
  }
  if (COMMIT) {
    try {
      const result = await (client as any).adminImport.commit.mutate({ domain, commitToken, rows })
      console.log(`  committed: ${JSON.stringify(result.summary)}`)
    } catch (e) {
      console.error(`  COMMIT FAILED for ${domain}:`, e)
      return false
    }
  }
  return true
}

/** Geography has its own preview/commit pair (no client-supplied rows --
 *  the source is the bundled LGD dataset, per adminImport.ts). */
async function runGeography(): Promise<boolean> {
  const preview = await (client as any).adminImport.previewGeographyLoad.mutate()
  printSummary('geography', preview.summary)
  if (!preview.reconciliation.matches) {
    console.error(`  reconciliation mismatch: ${JSON.stringify(preview.reconciliation)}`)
    return false
  }
  const rejects = preview.rows.filter((r: any) => r.action === 'reject')
  if (rejects.length > 0) {
    printRejects(rejects)
    return false
  }
  if (COMMIT) {
    try {
      const result = await (client as any).adminImport.commitGeographyLoad.mutate({ commitToken: preview.commitToken })
      console.log(`  committed: ${JSON.stringify(result.summary)}`)
    } catch (e) {
      console.error('  COMMIT FAILED for geography:', e)
      return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`API_BASE_URL=${API_BASE_URL}  mode=${COMMIT ? 'COMMIT' : 'DRY RUN (no writes)'}`)
  console.log('Building seed data from the frontend builders...')

  const seed = buildSeed()
  const orgNodes = seed.nodes.filter((n) => n.domain === 'org')
  // Not one of the 11 Admin Data Import domains -- there is no ownership
  // import procedure at all (adminImport.ts's domainSchema has no
  // 'ownership' entry). Built anyway for parity with seed-import.ts and to
  // surface that gap explicitly, but its rows are never sent anywhere.
  const ownershipAssignments = buildOwnershipFixture(orgNodes, seed.salesPersons)
  console.log(
    `Loaded: ${seed.nodes.length} hierarchy nodes (${orgNodes.length} org), ${seed.employees.length} employees, ` +
    `${seed.salesPersons.length} sales persons, ${seed.salesPostings.length} sales postings, ` +
    `${Object.values(seed.commercialCalculator.masters).reduce((n, arr: any) => n + arr.length, 0)} commercial masters, ` +
    `${seed.commercialCalculator.commercialSkus.length} commercial SKUs, ${seed.commercialCalculator.commercialBomItems.length} BOM items ` +
    `(${ownershipAssignments.length} ownership assignments built but unused -- no import domain covers them).`,
  )

  // --- 1. organizationHierarchy ---------------------------------------
  // Org nodes are keyed by `code`, not id (OrgSpec.code is technically
  // optional -- gov-hierarchy.ts falls back to `null` -- so this filters
  // defensively; every node in the current dataset does carry a code).
  const codedOrgNodes = orgNodes.filter((n) => n.code)
  if (codedOrgNodes.length !== orgNodes.length) {
    console.warn(`  WARNING: ${orgNodes.length - codedOrgNodes.length} org node(s) have no code and were excluded from organizationHierarchy rows.`)
  }
  const orgNodeById = new Map(codedOrgNodes.map((n) => [n.id, n]))
  const orgHierarchyRows = codedOrgNodes.map((n) => ({
    nodeType: n.typeKey,
    name: n.name,
    code: n.code,
    parentCode: n.parentId ? orgNodeById.get(n.parentId)?.code ?? null : null,
    stateCode: n.stateCode,
    status: n.status,
  }))

  // --- 2. employees ------------------------------------------------------
  // Every seeded employee (including vacant government seats) always has a
  // non-empty `code` (gov-hierarchy.ts mints `POS-${id}` for vacant seats),
  // so managerCode always resolves when managerId is set. An employee
  // posted to an org node that got excluded above (no code) is skipped too,
  // since orgNodeCode is a required column.
  //
  // Judgment call (found via a live dry run against goms-prod, 2026-08-27):
  // the demo dataset models a vacant government seat as an employee record
  // with `name: ''` (src/data/gov-hierarchy.ts) -- deliberately blank,
  // representing "nobody holds this position". The Admin Data Import
  // employees schema requires a non-blank Name (employeeRowSchema in
  // apps/api/src/import/domains/employees.ts), since a spreadsheet row with
  // no name isn't a meaningful concept there. Rather than inventing a
  // placeholder name (fabricated content, not present in the source data),
  // vacant seats are skipped from this import entirely -- the org hierarchy
  // position itself still gets created via organizationHierarchy, there is
  // simply no employee record occupying it, same end state as "vacant" was
  // already meant to convey.
  const employeeById = new Map(seed.employees.map((e) => [e.id, e]))
  const employeeRows: any[] = []
  let skippedForMissingOrgCode = 0
  let skippedForVacantNoName = 0
  for (const e of seed.employees) {
    if (e.vacant && !e.name.trim()) { skippedForVacantNoName++; continue }
    const orgNode = orgNodeById.get(e.orgNodeId)
    if (!orgNode?.code) { skippedForMissingOrgCode++; continue }
    employeeRows.push({
      employeeCode: e.code,
      name: e.name,
      designation: e.designation,
      email: e.email,
      phone: e.phone,
      orgNodeCode: orgNode.code,
      managerCode: e.managerId ? employeeById.get(e.managerId)?.code ?? null : null,
      vacant: e.vacant,
      status: e.status,
    })
  }
  if (skippedForVacantNoName > 0) {
    console.warn(`  WARNING: ${skippedForVacantNoName} vacant government seat(s) with no name were excluded from employees rows (Admin Data Import requires a non-blank Name; the org hierarchy position itself is still created).`)
  }
  if (skippedForMissingOrgCode > 0) {
    console.warn(`  WARNING: ${skippedForMissingOrgCode} employee(s) posted to a code-less org node were excluded from employees rows.`)
  }

  // --- 3. salesRoster (persons + postings) --------------------------------
  const salesPersonById = new Map(seed.salesPersons.map((p) => [p.id, p]))
  const salesPersonsRows = seed.salesPersons.map((p) => ({
    officialEmail: p.officialEmail,
    name: p.name,
    personalEmail: p.personalEmail,
    mobile: p.mobile,
    altMobile: p.altMobile,
    joinedOn: p.joinedOn,
    status: p.status,
  }))
  const salesPostingsRows = seed.salesPostings.map((sp) => {
    const person = salesPersonById.get(sp.salesPersonId)
    const manager = sp.managerId ? salesPersonById.get(sp.managerId) : null
    return {
      salesPersonEmail: person?.officialEmail ?? '',
      designation: sp.designation,
      tierKey: sp.tierKey,
      managerEmail: manager?.officialEmail ?? null,
      office: sp.office,
      startDate: sp.startDate || UNKNOWN_START_DATE_SENTINEL,
      reason: sp.reason,
    }
  })
  const salesRosterRows = { persons: salesPersonsRows, postings: salesPostingsRows }

  // --- 4/5/6/7. commercial masters ----------------------------------------
  const masters = seed.commercialCalculator.masters as any
  const flatMasterRow = (m: any) => ({ code: m.code, name: m.name, description: m.description, active: m.active, displayOrder: m.displayOrder })

  // commercialMastersFlat: the 4 independent flat reference-list sheets
  // (apps/api/src/import/domains/commercialMastersFlat.ts's FLAT_SHEET_KEYS).
  const flatRows = {
    skuCategories: masters.skuCategories.map(flatMasterRow),
    unitsOfMeasure: masters.unitsOfMeasure.map(flatMasterRow),
    productEditions: masters.productEditions.map(flatMasterRow),
    billingTypes: masters.billingTypes.map(flatMasterRow),
  }

  // commercialMastersCatalog: Verticals -> Products -> Modules -> Features,
  // chained by Parent Code (business key), resolved here from the demo
  // dataset's internal parent *ids* (verticalId/productId/moduleId).
  const verticalCodeById = codeMapById(masters.verticals)
  const productCodeById = codeMapById(masters.products)
  const moduleCodeById = codeMapById(masters.modules)
  const catalogRows = {
    verticals: masters.verticals.map((v: any) => ({ ...flatMasterRow(v), parentCode: null })),
    products: masters.products.map((p: any) => ({ ...flatMasterRow(p), parentCode: verticalCodeById.get(p.verticalId) ?? null })),
    modules: masters.modules.map((m: any) => ({ ...flatMasterRow(m), parentCode: productCodeById.get(m.productId) ?? null })),
    // ProductFeature.status is a 3-way FeatureStatus ('existing'|'modified'|
    // 'new'); the import schema's Feature Status column only accepts
    // 'new'|'existing' (featureRowSchema in commercialMastersCatalog.ts).
    // Judgment call: 'modified' downgrades to 'existing' (a modified
    // feature is, at minimum, an existing one) rather than being dropped or
    // left to fail validation -- no seed feature actually uses 'modified'
    // today, so this is precautionary, not exercised.
    features: masters.features.map((f: any) => ({
      ...flatMasterRow(f),
      parentCode: moduleCodeById.get(f.moduleId) ?? null,
      featureStatus: f.status === 'modified' ? 'existing' : f.status,
    })),
  }

  // currencies / taxClasses / approvalMatrix: dedicated domains, each a
  // direct field-for-field mapping off the matching MasterRowMap row.
  const currencyRows = masters.currencies.map((c: any) => ({
    code: c.code, name: c.name, symbol: c.symbol, decimalPlaces: c.decimalPlaces,
    exchangeRate: c.exchangeRate, isBaseCurrency: c.isBaseCurrency, active: c.active, displayOrder: c.displayOrder,
  }))
  const taxClassRows = masters.taxClasses.map((t: any) => ({
    code: t.code, name: t.name, description: t.description, ratePct: t.ratePct, active: t.active, displayOrder: t.displayOrder,
  }))
  const approvalMatrixRows = masters.approvalMatrix.map((a: any) => ({
    code: a.code, name: a.name, description: a.description, minDiscountPct: a.minDiscountPct, maxDiscountPct: a.maxDiscountPct,
    approvalLevelLabel: a.approvalLevelLabel, allowAutoApproval: a.allowAutoApproval, active: a.active, displayOrder: a.displayOrder,
  }))
  // Judgment call: masters.preSales has no corresponding Admin Data Import
  // domain at all (the 11 domains cover the other 11 of the Commercial
  // Calculator's 12 master keys -- see adminImport.ts's domainSchema).
  // scripts/seed-import.ts inserts it directly into Postgres via its own
  // masterKeyOrder loop; there is nothing to route it through here, so it's
  // silently not imported. Flagged, not inserted, not worked around.
  if (masters.preSales.length > 0) {
    console.warn(`  WARNING: ${masters.preSales.length} preSales master row(s) have no Admin Data Import domain and are not imported by this script.`)
  }

  // --- 8. skus -------------------------------------------------------------
  const skuCategoryCodeById = codeMapById(masters.skuCategories)
  const featureCodeById = codeMapById(masters.features)
  const editionCodeById = codeMapById(masters.productEditions)
  const uomCodeById = codeMapById(masters.unitsOfMeasure)
  const currencyCodeById = codeMapById(masters.currencies)
  const taxClassCodeById = codeMapById(masters.taxClasses)
  const billingTypeCodeById = codeMapById(masters.billingTypes)
  const skuRows = seed.commercialCalculator.commercialSkus.map((s: any) => ({
    skuCode: s.skuCode,
    name: s.name,
    categoryCode: skuCategoryCodeById.get(s.categoryId) ?? '',
    featureCode: featureCodeById.get(s.featureId) ?? '',
    editionCode: editionCodeById.get(s.editionId) ?? '',
    uomCode: uomCodeById.get(s.uomId) ?? '',
    currencyCode: currencyCodeById.get(s.currencyId) ?? '',
    taxClassCode: taxClassCodeById.get(s.taxClassId) ?? '',
    billingTypeCode: billingTypeCodeById.get(s.billingTypeId) ?? '',
    activeFrom: s.activeFrom,
    activeTill: s.activeTill,
    lifecycleStatus: s.lifecycleStatus,
    isSellable: s.isSellable,
    displayOrder: s.displayOrder,
    baseSoftwareCost: s.baseSoftwareCost,
    implementationCostPerMM: s.implementationCostPerMM,
    integrationCost: s.integrationCost,
    thirdPartyCost: s.thirdPartyCost,
    hardwareCost: s.hardwareCost,
    cloudCost: s.cloudCost,
    supportCost: s.supportCost,
    trainingCost: s.trainingCost,
    internalPrice: s.internalPrice,
    floorPrice: s.floorPrice,
    partnerPrice: s.partnerPrice,
    governmentPrice: s.governmentPrice,
    enterprisePrice: s.enterprisePrice,
    corporatePrice: s.corporatePrice,
    listPrice: s.listPrice,
    minimumAllowedPrice: s.minimumAllowedPrice,
    maximumDiscountPercent: s.maximumDiscountPercent,
  }))

  // --- 9. bom ----------------------------------------------------------
  const skuCodeById = codeMapById(seed.commercialCalculator.commercialSkus.map((s: any) => ({ id: s.id, code: s.skuCode })))
  const bomRows = seed.commercialCalculator.commercialBomItems.map((b: any) => ({
    parentSkuCode: skuCodeById.get(b.parentSkuId) ?? '',
    componentSkuCode: skuCodeById.get(b.componentSkuId) ?? '',
    mandatory: b.mandatory,
    quantity: b.quantity,
    notes: b.notes,
  }))

  // ---------------------------------------------------------------------
  // Run every domain's validate (dry run) or validate-then-commit (--commit),
  // in the dependency order confirmed from each domain's own validateRows:
  // employees depends on organizationHierarchy (Org Node Code FK); skus
  // depends on commercialMastersCatalog (Feature Code) and
  // commercialMastersFlat (Category/UOM/Edition/Billing Type Code) plus
  // currencies/taxClasses; bom depends on skus. currencies/taxClasses/
  // approvalMatrix/commercialMastersFlat each validate against their own
  // commercial_masters rows only (no cross-domain FK), so their relative
  // order among each other doesn't matter. salesRoster has no FK on
  // organizationHierarchy or employees at all, but is kept in the position
  // the task's dependency order specifies.
  const domainRuns: { label: string; run: () => Promise<boolean> }[] = [
    { label: 'geography', run: runGeography },
    { label: 'organizationHierarchy', run: () => runDomain('organizationHierarchy', orgHierarchyRows) },
    { label: 'currencies', run: () => runDomain('currencies', currencyRows) },
    { label: 'taxClasses', run: () => runDomain('taxClasses', taxClassRows) },
    { label: 'approvalMatrix', run: () => runDomain('approvalMatrix', approvalMatrixRows) },
    { label: 'commercialMastersFlat', run: () => runDomain('commercialMastersFlat', flatRows) },
    { label: 'commercialMastersCatalog', run: () => runDomain('commercialMastersCatalog', catalogRows) },
    { label: 'employees', run: () => runDomain('employees', employeeRows) },
    { label: 'salesRoster', run: () => runDomain('salesRoster', salesRosterRows) },
    { label: 'skus', run: () => runDomain('skus', skuRows) },
    { label: 'bom', run: () => runDomain('bom', bomRows) },
  ]

  let anyFailed = false
  for (const { label, run } of domainRuns) {
    console.log(`\n=== ${label} ===`)
    const ok = await run()
    if (!ok) {
      anyFailed = true
      if (COMMIT) {
        console.error(`\nStopping: ${label} failed validate or commit. No further domains were attempted.`)
        process.exitCode = 1
        return
      }
      // Dry run: keep going so every domain's validate summary is visible
      // in one pass, per the task's "for every domain" dry-run contract.
    }
  }

  if (anyFailed) {
    console.error('\nOne or more domains had reject rows. See detail above.')
    process.exitCode = 1
  } else {
    console.log(`\nAll domains validated cleanly.${COMMIT ? ' Commits applied in dependency order.' : ' Re-run with --commit to write.'}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
