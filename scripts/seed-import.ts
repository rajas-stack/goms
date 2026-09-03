// One-time, idempotent Postgres seed-import script.
//
// Reuses the *actual* existing frontend seed builders (buildSeed,
// buildOwnershipFixture) rather than reimplementing the data — this script's
// only new logic is the id-remapping + ordered-insert engine that gets that
// data into Postgres. Run with:
//
//   DATABASE_URL=postgresql://... npx tsx scripts/seed-import.ts [--reset]
//
// Without --reset, the script aborts if the target tables are non-empty
// (idempotent: safe to run against a fresh database, unsafe to run twice by
// accident). With --reset, it truncates the target tables first.
//
// goms-dev's Cloud SQL has no public IP (same constraint the goms-migrate
// Cloud Run Job exists for) — this script cannot reach it directly from
// outside GCP's VPC. It has been proven end-to-end against a local Postgres;
// running it against goms-dev is a documented operator follow-up, matching
// every other GCP-touching step in this migration.

import { randomUUID } from 'node:crypto'
import { Pool, types } from 'pg'
import { buildSeed } from '../src/data/seed.js'
import { buildOwnershipFixture } from '../src/data/ownership-fixture.js'

// Same coercions apps/api/src/db.ts uses, so seeded rows read back with the
// same JS types the routers themselves produce.
types.setTypeParser(1082, (val: string) => val)
types.setTypeParser(1700, (val: string) => Number(val))

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const RESET = process.argv.includes('--reset')

// A NOT NULL sentinel for the one field the frontend seed data leaves
// genuinely unknown (SalesPosting.startDate: '' -- "unknown stays visibly
// unknown", per sales-roster-seed.ts's own comment) but the Postgres schema
// requires a real DATE. 1970-01-01 is unambiguous as "not a real join date"
// (no AMNEX sales hire predates the company) -- chosen over silently
// inventing a plausible-looking date, and over loosening the NOT NULL
// constraint on an already-deployed table for one seed script's convenience.
const UNKNOWN_DATE_SENTINEL = '1970-01-01'

// --- id remapping ------------------------------------------------------

const idMap = new Map<string, string>()
function fresh(oldId: string): string {
  let next = idMap.get(oldId)
  if (!next) { next = randomUUID(); idMap.set(oldId, next) }
  return next
}
function resolve(oldId: string | null | undefined): string | null {
  if (!oldId) return null
  const mapped = idMap.get(oldId)
  if (!mapped) throw new Error(`seed-import: reference to unknown id "${oldId}" -- insert order bug`)
  return mapped
}

async function insertBatch(
  label: string,
  rows: unknown[],
  insertOne: (client: import('pg').PoolClient, row: any) => Promise<void>,
): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const row of rows) await insertOne(client, row)
    await client.query('COMMIT')
    console.log(`  inserted ${rows.length} ${label}`)
    return rows.length
  } catch (e) {
    await client.query('ROLLBACK')
    throw new Error(`seed-import: failed inserting ${label}: ${(e as Error).message}`)
  } finally {
    client.release()
  }
}

// --- idempotency guard ---------------------------------------------------

async function assertEmptyOrReset(): Promise<void> {
  const tables = ['hierarchy_nodes', 'commercial_masters', 'sales_persons']
  for (const t of tables) {
    const r = await pool.query(`SELECT COUNT(*) FROM ${t}`)
    if (Number(r.rows[0].count) > 0) {
      if (!RESET) {
        throw new Error(
          `seed-import: target tables are not empty (${t} has ${r.rows[0].count} rows) -- ` +
          `this script only seeds a fresh database. Pass --reset to wipe and reseed.`,
        )
      }
      console.log('--reset passed: truncating target tables...')
      await pool.query(
        `TRUNCATE ownership_assignments, sales_postings, sales_persons, edition_features,
         commercial_skus, commercial_masters, employee_charges, timeline_events, transfers,
         employees, hierarchy_nodes RESTART IDENTITY CASCADE`,
      )
      return
    }
  }
}

// --- main ------------------------------------------------------------------

async function main() {
  await assertEmptyOrReset()

  console.log('Building seed data from the frontend builders...')
  const seed = buildSeed()
  const orgNodes = seed.nodes.filter((n) => n.domain === 'org')
  const ownershipAssignments = buildOwnershipFixture(orgNodes, seed.salesPersons)

  console.log(
    `Loaded: ${seed.nodes.length} hierarchy nodes, ${seed.employees.length} employees, ` +
    `${seed.salesPersons.length} sales persons, ${seed.salesPostings.length} sales postings, ` +
    `${Object.values(seed.commercialCalculator.masters).reduce((n, arr) => n + arr.length, 0)} commercial masters, ` +
    `${seed.commercialCalculator.commercialSkus.length} commercial SKUs, ${ownershipAssignments.length} ownership assignments.`,
  )

  const counts: Record<string, number> = {}

  // 1. hierarchy_nodes -- array order is already parent-before-child.
  counts.hierarchy_nodes = await insertBatch('hierarchy_nodes', seed.nodes, async (client, n) => {
    await client.query(
      `INSERT INTO hierarchy_nodes (id, domain, type_key, parent_id, state_code, name, code, sort_order, metadata, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [fresh(n.id), n.domain, n.typeKey, resolve(n.parentId), n.stateCode, n.name, n.code, n.sortOrder, JSON.stringify(n.metadata), n.status],
    )
  })

  // 2. employees -- insert with manager_id NULL first (a manager can be
  // pushed later in the array than their report, across org-group branches),
  // then backfill manager_id in a second pass now every employee id exists.
  counts.employees = await insertBatch('employees', seed.employees, async (client, e) => {
    await client.query(
      `INSERT INTO employees (
         id, code, name, designation, email, phone, company, address, website, photo_url,
         org_node_id, manager_id, vacant, connected, relationship_status, relationship_quality,
         relationship_type, introduced_by, important_contact, preferred_comm,
         last_interaction_at, follow_up_date, notes, visiting_cards, metadata, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [
        fresh(e.id), e.code, e.name, e.designation, e.email, e.phone, e.company, e.address, e.website, e.photoUrl,
        resolve(e.orgNodeId), null, e.vacant, e.connected, e.relationshipStatus, e.relationshipQuality,
        e.relationshipType, e.introducedBy, e.importantContact, JSON.stringify(e.preferredComm),
        e.lastInteractionAt, e.followUpDate, e.notes, JSON.stringify(e.charges ?? []), JSON.stringify(e.metadata), e.status,
      ],
    )
  })
  {
    const withManager = seed.employees.filter((e) => e.managerId)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const e of withManager) {
        await client.query('UPDATE employees SET manager_id=$1 WHERE id=$2', [resolve(e.managerId), resolve(e.id)])
      }
      await client.query('COMMIT')
      console.log(`  backfilled manager_id on ${withManager.length} employees`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw new Error(`seed-import: failed backfilling employee manager_id: ${(err as Error).message}`)
    } finally {
      client.release()
    }
  }

  // 3. sales_persons
  counts.sales_persons = await insertBatch('sales persons', seed.salesPersons, async (client, p) => {
    await client.query(
      `INSERT INTO sales_persons (id, employee_code, name, official_email, personal_email, mobile, alt_mobile, joined_on, left_on, status, notes, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [fresh(p.id), p.employeeCode, p.name, p.officialEmail, p.personalEmail, p.mobile, p.altMobile, p.joinedOn, p.leftOn, p.status, p.notes, JSON.stringify(p.metadata)],
    )
  })

  // 4. sales_postings -- startDate is '' in the seed (genuinely unknown);
  // sales_postings.start_date is NOT NULL, so the sentinel above is used.
  counts.sales_postings = await insertBatch('sales postings', seed.salesPostings, async (client, sp) => {
    await client.query(
      `INSERT INTO sales_postings (id, sales_person_id, designation, tier_key, manager_id, office, start_date, end_date, change_type, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        fresh(sp.id), resolve(sp.salesPersonId), sp.designation, sp.tierKey, resolve(sp.managerId), sp.office,
        sp.startDate || UNKNOWN_DATE_SENTINEL, sp.endDate, sp.changeType, sp.reason,
      ],
    )
  })

  // 5. commercial_masters -- parents before children within the hierarchy
  // kinds; the other 8 kinds have no parent_id so order doesn't matter.
  const masterParentField: Record<string, string | null> = {
    verticals: null, products: 'verticalId', modules: 'productId', features: 'moduleId',
    skuCategories: null, unitsOfMeasure: null, productEditions: null, billingTypes: null,
    taxClasses: null, approvalMatrix: null, currencies: null, preSales: null,
  }
  const masterExtraFields: Record<string, string[]> = {
    verticals: [], products: [], modules: [], features: ['status'],
    skuCategories: [], unitsOfMeasure: [], productEditions: [], billingTypes: [],
    taxClasses: ['ratePct'], approvalMatrix: ['minDiscountPct', 'maxDiscountPct', 'approvalLevelLabel', 'allowAutoApproval'],
    currencies: ['symbol', 'decimalPlaces', 'exchangeRate', 'isBaseCurrency'], preSales: [],
  }
  const masterKeyOrder = [
    'verticals', 'products', 'modules', 'features',
    'skuCategories', 'unitsOfMeasure', 'productEditions', 'billingTypes', 'taxClasses', 'approvalMatrix', 'currencies', 'preSales',
  ] as const

  let masterTotal = 0
  for (const key of masterKeyOrder) {
    const rows = (seed.commercialCalculator.masters as any)[key] as any[]
    const parentField = masterParentField[key]
    const extraFields = masterExtraFields[key]
    masterTotal += await insertBatch(`commercial_masters(${key})`, rows, async (client, m) => {
      const extra: Record<string, unknown> = {}
      for (const f of extraFields) extra[f] = m[f]
      await client.query(
        `INSERT INTO commercial_masters (id, master_key, parent_id, code, name, description, active, display_order, extra)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [fresh(m.id), key, parentField ? resolve(m[parentField]) : null, m.code, m.name, m.description ?? '', m.active ?? true, m.displayOrder ?? 0, JSON.stringify(extra)],
      )
    })
  }
  counts.commercial_masters = masterTotal

  // 6. commercial_skus -- every FK already inserted in step 5.
  counts.commercial_skus = await insertBatch('commercial SKUs', seed.commercialCalculator.commercialSkus, async (client, s) => {
    await client.query(
      `INSERT INTO commercial_skus (
         id, sku_code, name, category_id, feature_id, edition_id, uom_id, currency_id, tax_class_id, billing_type_id,
         active_from, active_till, lifecycle_status, is_sellable, display_order,
         base_software_cost, implementation_cost_per_mm, integration_cost, third_party_cost,
         hardware_cost, cloud_cost, support_cost, training_cost,
         internal_price, floor_price, partner_price, government_price, enterprise_price, corporate_price, list_price,
         minimum_allowed_price, maximum_discount_percent, selected_pricing_levels
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)`,
      [
        fresh(s.id), s.skuCode, s.name, resolve(s.categoryId), resolve(s.featureId), resolve(s.editionId), resolve(s.uomId),
        resolve(s.currencyId), resolve(s.taxClassId), resolve(s.billingTypeId),
        s.activeFrom, s.activeTill, s.lifecycleStatus, s.isSellable, s.displayOrder,
        s.baseSoftwareCost, s.implementationCostPerMM, s.integrationCost, s.thirdPartyCost,
        s.hardwareCost, s.cloudCost, s.supportCost, s.trainingCost,
        s.internalPrice, s.floorPrice, s.partnerPrice, s.governmentPrice, s.enterprisePrice, s.corporatePrice, s.listPrice,
        s.minimumAllowedPrice, s.maximumDiscountPercent, JSON.stringify(s.selectedPricingLevels ?? []),
      ],
    )
  })

  // 7. ownership_assignments -- entityId resolves against hierarchy_nodes
  // (entityType is always 'orgNode' for this fixture).
  counts.ownership_assignments = await insertBatch('ownership assignments', ownershipAssignments, async (client, o) => {
    await client.query(
      `INSERT INTO ownership_assignments (id, entity_type, entity_id, sales_person_id, role, start_date, end_date, reason, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [fresh(o.id), o.entityType, resolve(o.entityId), resolve(o.salesPersonId), o.role, o.startDate, o.endDate, o.reason, o.note],
    )
  })

  // 8. timeline_events -- entityId resolves against employees, inserted above.
  // Root-caused 2026-09-03: this step never existed, despite `seed.timeline`
  // being built and destructured right alongside every other table above,
  // and despite the --reset TRUNCATE list (assertEmptyOrReset) already
  // including timeline_events as if this table were seeded too. The gap was
  // invisible locally because the in-memory/IndexedDB repository (src/data/
  // seed.ts's actual consumer in that mode) reads `seed.timeline` directly,
  // with no import step to forget — only this Postgres path needed it and
  // silently didn't get it. Net effect on any already-seeded environment
  // (e.g. goms-dev): every employee's manual/system timeline history
  // (meetings, "Contact created" events, etc.) from the fixture data is
  // simply absent until this script is re-run there.
  counts.timeline_events = await insertBatch('timeline events', seed.timeline, async (client, t) => {
    await client.query(
      `INSERT INTO timeline_events (id, employee_id, type, title, custom_label, date, time, note, source, attendees, attended, agenda, outcome, next_steps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        fresh(t.id), resolve(t.employeeId), t.type, t.title, t.customLabel ?? null, t.date, t.time ?? null,
        t.note ?? '', t.source, t.attendees ? JSON.stringify(t.attendees) : null, t.attended ?? null,
        t.agenda ?? null, t.outcome ?? null, t.nextSteps ?? null,
      ],
    )
  })

  await reconcile({
    hierarchy_nodes: seed.nodes.length,
    employees: seed.employees.length,
    sales_persons: seed.salesPersons.length,
    sales_postings: seed.salesPostings.length,
    commercial_masters: masterTotal,
    commercial_skus: seed.commercialCalculator.commercialSkus.length,
    ownership_assignments: ownershipAssignments.length,
    timeline_events: seed.timeline.length,
  }, counts)
}

// --- validation / reconciliation --------------------------------------

async function reconcile(expected: Record<string, number>, actualInserted: Record<string, number>): Promise<void> {
  console.log('\n--- Reconciliation ---')
  let failures = 0

  for (const [table, expectedCount] of Object.entries(expected)) {
    const r = await pool.query(`SELECT COUNT(*) FROM ${table}`)
    const dbCount = Number(r.rows[0].count)
    const ok = dbCount === expectedCount && actualInserted[table] === expectedCount
    console.log(`${ok ? 'PASS' : 'FAIL'} ${table}: expected ${expectedCount}, inserted ${actualInserted[table]}, in DB ${dbCount}`)
    if (!ok) failures++
  }

  const integrityChecks: [string, string][] = [
    ['hierarchy_nodes.parent_id orphans', `SELECT id FROM hierarchy_nodes WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM hierarchy_nodes)`],
    ['employees.manager_id orphans', `SELECT id FROM employees WHERE manager_id IS NOT NULL AND manager_id NOT IN (SELECT id FROM employees)`],
    ['employees.org_node_id orphans', `SELECT id FROM employees WHERE org_node_id NOT IN (SELECT id FROM hierarchy_nodes)`],
    ['sales_postings.sales_person_id orphans', `SELECT id FROM sales_postings WHERE sales_person_id NOT IN (SELECT id FROM sales_persons)`],
    ['commercial_masters.parent_id orphans', `SELECT id FROM commercial_masters WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM commercial_masters)`],
    ['commercial_skus.feature_id/edition_id orphans', `SELECT id FROM commercial_skus WHERE feature_id NOT IN (SELECT id FROM commercial_masters) OR edition_id NOT IN (SELECT id FROM commercial_masters)`],
    ['ownership_assignments.sales_person_id orphans', `SELECT id FROM ownership_assignments WHERE sales_person_id NOT IN (SELECT id FROM sales_persons)`],
    ['timeline_events.employee_id orphans', `SELECT id FROM timeline_events WHERE employee_id NOT IN (SELECT id FROM employees)`],
  ]
  for (const [label, sql] of integrityChecks) {
    const r = await pool.query(sql)
    const ok = r.rows.length === 0
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${r.rows.length} orphan row(s)`)
    if (!ok) failures++
  }

  const total = Object.values(expected).reduce((a, b) => a + b, 0)
  console.log(`\nTotal rows inserted: ${total}. ${failures === 0 ? 'ALL CHECKS PASSED.' : `${failures} CHECK(S) FAILED.`}`)
  if (failures > 0) process.exitCode = 1
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => pool.end())
