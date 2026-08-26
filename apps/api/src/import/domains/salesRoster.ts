import { z } from 'zod'
import { SALES_TIERS, tierRank } from '@goms/domain'
import { classifyRows, resolveTreeReferences } from '../engine.js'
import type { ImportFieldDiff, ImportRowResult } from '../types.js'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIER_KEYS = new Set(SALES_TIERS.map((t) => t.key))

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function postingKey(email: string, startDate: string): string {
  return `${email}|${startDate}`
}

// ---------------------------------------------------------------------------
// Sales Persons sheet
// ---------------------------------------------------------------------------

const statusSchema = z.enum(['active', 'onLeave', 'resigned', 'inactive'])

const salesPersonRowSchema = z.object({
  officialEmail: z.string().min(1, 'Official Email is required').trim(),
  name: z.string().min(1, 'Name is required'),
  personalEmail: z.string().optional().default(''),
  mobile: z.string().optional().default(''),
  altMobile: z.string().optional().default(''),
  joinedOn: z.string().nullable().optional().default(null),
  status: statusSchema.optional().default('active'),
})
export type SalesPersonRow = z.infer<typeof salesPersonRowSchema>

interface ExistingPerson {
  id: string
  name: string
  officialEmail: string
  personalEmail: string
  mobile: string
  altMobile: string
  joinedOn: string | null
  status: string
}

async function fetchExistingPersons(client: { query: Function }): Promise<Map<string, ExistingPerson>> {
  const result = await client.query(`SELECT * FROM sales_persons`)
  const map = new Map<string, ExistingPerson>()
  for (const row of result.rows) {
    map.set(normalizeEmail(row.official_email), {
      id: row.id,
      name: row.name,
      officialEmail: row.official_email,
      personalEmail: row.personal_email,
      mobile: row.mobile,
      altMobile: row.alt_mobile,
      joinedOn: row.joined_on,
      status: row.status,
    })
  }
  return map
}

function diffPerson(row: SalesPersonRow, existing: ExistingPerson): ImportFieldDiff[] {
  const diffs: ImportFieldDiff[] = []
  if (row.name !== existing.name) diffs.push({ field: 'name', oldValue: existing.name, newValue: row.name })
  if (row.officialEmail !== existing.officialEmail) diffs.push({ field: 'officialEmail', oldValue: existing.officialEmail, newValue: row.officialEmail })
  if (row.personalEmail !== existing.personalEmail) diffs.push({ field: 'personalEmail', oldValue: existing.personalEmail, newValue: row.personalEmail })
  if (row.mobile !== existing.mobile) diffs.push({ field: 'mobile', oldValue: existing.mobile, newValue: row.mobile })
  if (row.altMobile !== existing.altMobile) diffs.push({ field: 'altMobile', oldValue: existing.altMobile, newValue: row.altMobile })
  if (row.joinedOn !== existing.joinedOn) diffs.push({ field: 'joinedOn', oldValue: existing.joinedOn, newValue: row.joinedOn })
  if (row.status !== existing.status) diffs.push({ field: 'status', oldValue: existing.status, newValue: row.status })
  return diffs
}

function validatePersonRows(rawRows: unknown[], existingByKey: Map<string, ExistingPerson>): ImportRowResult[] {
  return classifyRows<unknown, ExistingPerson>({
    rows: rawRows,
    getBusinessKey: (raw, index) => {
      const parsed = salesPersonRowSchema.safeParse(raw)
      if (parsed.success) return normalizeEmail(parsed.data.officialEmail)
      if (typeof raw !== 'object' || raw === null) return `__row_${index}__`
      const rawEmail = (raw as Record<string, unknown>).officialEmail
      if (typeof rawEmail === 'string' && rawEmail.trim() !== '') return normalizeEmail(rawEmail)
      // Blank/missing/non-string email: still a distinct, valid row — key it
      // by its own position so it reaches validateRow (and gets the precise
      // "Official Email is required" message) instead of being silently
      // swallowed as a "duplicate" of some other row that also has no email.
      return `__row_${index}__`
    },
    existingByKey,
    diffFields: (raw, existing) => diffPerson(salesPersonRowSchema.parse(raw), existing),
    validateRow: (raw) => {
      const parsed = salesPersonRowSchema.safeParse(raw)
      if (parsed.success) return []
      return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    },
  })
}

// ---------------------------------------------------------------------------
// Postings sheet
// ---------------------------------------------------------------------------

const salesPostingRowSchema = z.object({
  salesPersonEmail: z.string().min(1, 'Sales Person Email is required').trim(),
  designation: z.string().min(1, 'Designation is required'),
  tierKey: z.string().min(1, 'Tier Key is required'),
  managerEmail: z.string().nullable().optional().default(null),
  office: z.string().optional().default(''),
  startDate: z.string().min(1, 'Start Date is required').regex(ISO_DATE_RE, 'Start Date must be a valid date (YYYY-MM-DD)'),
  reason: z.string().optional().default(''),
})
export type SalesPostingRow = z.infer<typeof salesPostingRowSchema>

interface ExistingPosting {
  id: string
  salesPersonId: string
  designation: string
  tierKey: string
  managerId: string | null
  managerEmail: string | null
  office: string
  startDate: string
  endDate: string | null
  changeType: string
  reason: string
}

/** Sorted ascending by `startDate` within each person, matching the order
 *  `sales.ts`'s own postings history is displayed/derived in. */
async function fetchExistingPostingsByPerson(client: { query: Function }): Promise<Map<string, ExistingPosting[]>> {
  const result = await client.query(
    `SELECT sp.id, sp.sales_person_id, sp.designation, sp.tier_key, sp.manager_id, sp.office,
            sp.start_date, sp.end_date, sp.change_type, sp.reason,
            per.official_email AS person_email, mgr.official_email AS manager_email
     FROM sales_postings sp
     JOIN sales_persons per ON per.id = sp.sales_person_id
     LEFT JOIN sales_persons mgr ON mgr.id = sp.manager_id
     ORDER BY sp.start_date ASC`,
  )
  const map = new Map<string, ExistingPosting[]>()
  for (const row of result.rows) {
    const email = normalizeEmail(row.person_email)
    const list = map.get(email) ?? []
    list.push({
      id: row.id,
      salesPersonId: row.sales_person_id,
      designation: row.designation,
      tierKey: row.tier_key,
      managerId: row.manager_id,
      managerEmail: row.manager_email ? normalizeEmail(row.manager_email) : null,
      office: row.office,
      startDate: row.start_date,
      endDate: row.end_date,
      changeType: row.change_type,
      reason: row.reason,
    })
    map.set(email, list)
  }
  return map
}

function flattenExistingPostingsByKey(byPerson: Map<string, ExistingPosting[]>): Map<string, ExistingPosting> {
  const map = new Map<string, ExistingPosting>()
  for (const [email, list] of byPerson) {
    for (const posting of list) map.set(postingKey(email, posting.startDate), posting)
  }
  return map
}

function diffPosting(row: SalesPostingRow, existing: ExistingPosting): ImportFieldDiff[] {
  const diffs: ImportFieldDiff[] = []
  if (row.designation !== existing.designation) diffs.push({ field: 'designation', oldValue: existing.designation, newValue: row.designation })
  if (row.tierKey !== existing.tierKey) diffs.push({ field: 'tierKey', oldValue: existing.tierKey, newValue: row.tierKey })
  const rowManagerEmail = row.managerEmail && row.managerEmail.trim() !== '' ? normalizeEmail(row.managerEmail) : null
  if (rowManagerEmail !== existing.managerEmail) diffs.push({ field: 'managerEmail', oldValue: existing.managerEmail, newValue: rowManagerEmail })
  if (row.office !== existing.office) diffs.push({ field: 'office', oldValue: existing.office, newValue: row.office })
  if (row.reason !== existing.reason) diffs.push({ field: 'reason', oldValue: existing.reason, newValue: row.reason })
  return diffs
}

/** Extracts a (email, startDate) key straight from the raw row even when the
 *  row otherwise fails schema validation (e.g. a bad Tier Key) — mirrors
 *  `taxClasses.ts`'s raw-field fallback for its own business key, so two
 *  equally-invalid rows for the same person/date are still correctly
 *  flagged as duplicates of each other rather than each minting its own
 *  synthetic key. */
function partialPostingKey(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  const email = typeof obj.salesPersonEmail === 'string' && obj.salesPersonEmail.trim() !== '' ? normalizeEmail(obj.salesPersonEmail) : null
  const startDate = typeof obj.startDate === 'string' && obj.startDate.trim() !== '' ? obj.startDate.trim() : null
  return email && startDate ? postingKey(email, startDate) : null
}

function validatePostingRows(
  rawRows: unknown[],
  resolvablePersonEmails: Set<string>,
  existingByKey: Map<string, ExistingPosting>,
): ImportRowResult[] {
  // Pass 1: schema/required/Tier-Key/Sales-Person-Email validation and
  // within-file duplicate detection via the generic engine. `existingByKey`
  // is deliberately empty here — classifyRows' create/update/unchanged
  // model has no way to *reject* a row that matches an existing key (only
  // unchanged/update), which is exactly what postings' append-only history
  // rule needs (see Pass 2). Every schema-valid row provisionally lands as
  // 'create'; Pass 2 re-derives the real action.
  const basePreview = classifyRows<unknown, unknown>({
    rows: rawRows,
    getBusinessKey: (raw, index) => {
      const parsed = salesPostingRowSchema.safeParse(raw)
      if (parsed.success) return postingKey(normalizeEmail(parsed.data.salesPersonEmail), parsed.data.startDate)
      return partialPostingKey(raw) ?? `__row_${index}__`
    },
    existingByKey: new Map(),
    diffFields: () => [],
    validateRow: (raw) => {
      const parsed = salesPostingRowSchema.safeParse(raw)
      if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      const row = parsed.data
      const errors: string[] = []
      if (!TIER_KEYS.has(row.tierKey)) {
        errors.push(`Tier Key "${row.tierKey}" is not a recognized tier key (must be one of: ${Array.from(TIER_KEYS).join(', ')})`)
      }
      if (!resolvablePersonEmails.has(normalizeEmail(row.salesPersonEmail))) {
        errors.push(`no such sales person for Sales Person Email: ${row.salesPersonEmail}`)
      }
      return errors
    },
  })

  // Pass 1b: resolve Manager Email against another Sales Person row, reusing
  // the same deferred two-pass tree resolver Org Hierarchy/Employees use for
  // Parent/Manager code chains (per the plan) rather than a bespoke lookup —
  // a manager can be an already-committed sales person or one created by
  // this same upload's Sales Persons sheet.
  const resolutionRows = rawRows.map((raw) => {
    const parsed = salesPostingRowSchema.safeParse(raw)
    if (!parsed.success) return { ownKey: '', parentKey: null as string | null }
    const ownKey = normalizeEmail(parsed.data.salesPersonEmail)
    const managerEmail = parsed.data.managerEmail
    const parentKey = managerEmail && managerEmail.trim() !== '' ? normalizeEmail(managerEmail) : null
    return { ownKey, parentKey }
  })
  const { unresolved } = resolveTreeReferences({
    rows: resolutionRows,
    getOwnKey: (r) => r.ownKey,
    getParentKey: (r) => r.parentKey,
    existingKeys: resolvablePersonEmails,
  })
  const unresolvedManagerIndexes = new Set(unresolved)

  // Pass 2: derive the real action per postings' append-only semantics — a
  // posting matching an existing (email, start date) is 'unchanged' if
  // every field matches, 'update' if it differs but is still the person's
  // currently-open posting (end_date IS NULL, so nothing is being
  // rewritten), or 'reject'ed as closed history if it differs and isn't.
  return basePreview.map((result, index) => {
    if (result.action === 'reject') return result

    if (unresolvedManagerIndexes.has(index)) {
      const raw = rawRows[index] as Record<string, unknown>
      return { ...result, action: 'reject', diff: undefined, errors: [`no such sales person for Manager Email: ${String(raw.managerEmail)}`] }
    }

    const row = salesPostingRowSchema.parse(rawRows[index])
    const existing = existingByKey.get(result.businessKey)
    if (!existing) return result // genuinely new posting: stays 'create'

    const diffs = diffPosting(row, existing)
    if (diffs.length === 0) return { ...result, action: 'unchanged' }
    if (existing.endDate !== null) {
      return { ...result, action: 'reject', diff: undefined, errors: ['cannot modify closed posting history via import'] }
    }
    return { ...result, action: 'update', diff: diffs }
  })
}

// ---------------------------------------------------------------------------
// Combined validate/commit
// ---------------------------------------------------------------------------

export async function validateSalesRosterRows(
  client: { query: Function },
  input: { persons: unknown[]; postings: unknown[] },
): Promise<{ persons: ImportRowResult[]; postings: ImportRowResult[] }> {
  const existingPersonsByEmail = await fetchExistingPersons(client)
  const personsPreview = validatePersonRows(input.persons, existingPersonsByEmail)

  // A posting's Sales Person Email / Manager Email may resolve against a row
  // already in the database, or a row in this same upload's Sales Persons
  // sheet that itself survived validation (create/update/unchanged) — a
  // rejected persons row resolves nothing.
  const resolvablePersonEmails = new Set<string>([
    ...existingPersonsByEmail.keys(),
    ...personsPreview.filter((r) => r.action !== 'reject').map((r) => r.businessKey),
  ])

  const existingPostingsByPerson = await fetchExistingPostingsByPerson(client)
  const existingPostingsByKey = flattenExistingPostingsByKey(existingPostingsByPerson)
  const postingsPreview = validatePostingRows(input.postings, resolvablePersonEmails, existingPostingsByKey)

  return {
    persons: personsPreview.map((r) => ({ ...r, sheet: 'Sales Persons' })),
    postings: postingsPreview.map((r) => ({ ...r, sheet: 'Postings' })),
  }
}

export async function commitSalesRosterRows(
  client: { query: Function },
  input: { persons: unknown[]; postings: unknown[] },
  preview: { persons: ImportRowResult[]; postings: ImportRowResult[] },
): Promise<void> {
  // 1. Commit the Sales Persons sheet first — Postings' Sales Person Email
  //    and Manager Email both need a real sales_persons.id to write, and a
  //    person created in this very commit must already have one by the
  //    time we process their posting rows below.
  const personIdByEmail = new Map<string, string>()
  for (const [email, existing] of await fetchExistingPersons(client)) personIdByEmail.set(email, existing.id)

  for (let i = 0; i < input.persons.length; i++) {
    const result = preview.persons[i]
    if (!result || (result.action !== 'create' && result.action !== 'update')) continue
    const row = salesPersonRowSchema.parse(input.persons[i])
    const email = normalizeEmail(row.officialEmail)
    if (result.action === 'create') {
      const inserted = await client.query(
        `INSERT INTO sales_persons (name, official_email, personal_email, mobile, alt_mobile, joined_on, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [row.name, row.officialEmail, row.personalEmail, row.mobile, row.altMobile, row.joinedOn, row.status],
      )
      personIdByEmail.set(email, inserted.rows[0].id)
    } else {
      await client.query(
        `UPDATE sales_persons SET name=$2, personal_email=$3, mobile=$4, alt_mobile=$5, joined_on=$6, status=$7, updated_at=now()
         WHERE lower(trim(official_email))=lower(trim($1))`,
        [row.officialEmail, row.name, row.personalEmail, row.mobile, row.altMobile, row.joinedOn, row.status],
      )
    }
  }

  // 2. Group create/update posting rows by their (already-normalized) Sales
  //    Person Email and process each person's rows in Start Date order —
  //    the same order `change_type` derivation and posting-closure depend
  //    on, per the design spec's "postings for one person are processed in
  //    Start Date order" rule.
  const rowsByPerson = new Map<string, { index: number; row: SalesPostingRow }[]>()
  for (let i = 0; i < input.postings.length; i++) {
    const result = preview.postings[i]
    if (!result || (result.action !== 'create' && result.action !== 'update')) continue
    const row = salesPostingRowSchema.parse(input.postings[i])
    const email = normalizeEmail(row.salesPersonEmail)
    const list = rowsByPerson.get(email) ?? []
    list.push({ index: i, row })
    rowsByPerson.set(email, list)
  }

  const existingPostingsByPerson = await fetchExistingPostingsByPerson(client)

  for (const [email, rows] of rowsByPerson) {
    rows.sort((a, b) => a.row.startDate.localeCompare(b.row.startDate))
    const personId = personIdByEmail.get(email)
    if (!personId) continue // Should be unreachable: preview validation already required this email to resolve.

    const existingList = existingPostingsByPerson.get(email) ?? []
    const openExisting = existingList.find((p) => p.endDate === null) ?? null
    let openPostingId = openExisting?.id ?? null
    let openStartDate = openExisting?.startDate ?? null
    let latestTierKey = existingList.length > 0 ? existingList[existingList.length - 1].tierKey : null

    for (const { index, row } of rows) {
      const result = preview.postings[index]
      const managerId = row.managerEmail && row.managerEmail.trim() !== ''
        ? personIdByEmail.get(normalizeEmail(row.managerEmail)) ?? null
        : null

      if (result.action === 'update') {
        // Patches the still-open posting in place (allowed because it's not
        // closed history yet) — never re-derives change_type, since this is
        // correcting the existing timeline entry, not appending a new one.
        await client.query(
          `UPDATE sales_postings SET designation=$2, tier_key=$3, manager_id=$4, office=$5, reason=$6
           WHERE sales_person_id=$1 AND start_date=$7`,
          [personId, row.designation, row.tierKey, managerId, row.office, row.reason, row.startDate],
        )
        if (openStartDate === row.startDate) latestTierKey = row.tierKey
        continue
      }

      // action === 'create': a genuinely new posting. Mirrors sales.ts's
      // transfer mutation (routers/sales.ts:130-146) — close the person's
      // current open posting (if any) before inserting the new one, and
      // derive change_type from a tierRank comparison against it.
      if (openPostingId) {
        await client.query(`UPDATE sales_postings SET end_date=$1 WHERE id=$2`, [row.startDate, openPostingId])
      }
      const oldRank = latestTierKey !== null ? tierRank(latestTierKey) : null
      const newRank = tierRank(row.tierKey)
      const changeType = oldRank === null ? 'initial' : newRank < oldRank ? 'promotion' : newRank > oldRank ? 'demotion' : 'lateralMove'

      const inserted = await client.query(
        `INSERT INTO sales_postings (sales_person_id, designation, tier_key, manager_id, office, start_date, end_date, change_type, reason)
         VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8) RETURNING id`,
        [personId, row.designation, row.tierKey, managerId, row.office, row.startDate, changeType, row.reason],
      )
      openPostingId = inserted.rows[0].id
      openStartDate = row.startDate
      latestTierKey = row.tierKey
    }
  }
}
