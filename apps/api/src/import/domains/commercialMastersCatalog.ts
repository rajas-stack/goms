import { z } from 'zod'
import { classifyRows, resolveTreeReferences } from '../engine.js'
import type { ImportFieldDiff, ImportRowResult } from '../types.js'

/** The four sheets of one workbook (spec §"5. Commercial Masters — Catalog
 *  Structure"), each its own `commercial_masters.master_key`, chained by
 *  `parent_id`: Verticals -> Products -> Modules -> Features. Processed in
 *  that fixed order because each level's Parent Code names a row in the
 *  level above it. */
type CatalogKind = 'verticals' | 'products' | 'modules' | 'features'

const CATALOG_KINDS: CatalogKind[] = ['verticals', 'products', 'modules', 'features']

/** Which kind each non-root kind's Parent Code resolves against. */
const PARENT_KIND: Record<Exclude<CatalogKind, 'verticals'>, CatalogKind> = {
  products: 'verticals',
  modules: 'products',
  features: 'modules',
}

/** Human label used in "no such X code" rejection messages. */
const PARENT_LABEL: Record<Exclude<CatalogKind, 'verticals'>, string> = {
  products: 'Vertical',
  modules: 'Product',
  features: 'Module',
}

const CATALOG_BASE_FIELDS = {
  code: z.string().min(1, 'Code is required').trim(),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().default(''),
  active: z.boolean().optional().default(true),
  displayOrder: z.number().optional().default(0),
}

// Verticals have no parent (spec: "blank for Verticals") — a stray value in
// that column is tolerated rather than rejected, since it carries no
// meaning for this sheet and rejecting it would be a surprising, undocumented
// stricture the spec doesn't ask for.
const verticalRowSchema = z.object({
  ...CATALOG_BASE_FIELDS,
  parentCode: z.string().trim().optional().nullable(),
})

// Products and Modules share the identical shape (Code/Name/Description/
// Active/Display Order/Parent Code, Parent Code required) — one schema for
// both, matching how `commercialMastersFlat.ts` shares one schema across its
// four sheet keys.
const childRowSchema = z.object({
  ...CATALOG_BASE_FIELDS,
  parentCode: z.string().min(1, 'Parent Code is required').trim(),
})

// Features add "Feature Status" (new/existing) -> extra.status, defaulting
// to 'new' when the column is blank/missing (matches ProductFeature.status's
// existing default expectations elsewhere in the app).
const featureRowSchema = z.object({
  ...CATALOG_BASE_FIELDS,
  parentCode: z.string().min(1, 'Parent Code is required').trim(),
  featureStatus: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.enum(['new', 'existing'], { invalid_type_error: 'featureStatus must be "new" or "existing"' }).default('new'),
  ),
})

export type VerticalRow = z.infer<typeof verticalRowSchema>
export type ProductOrModuleRow = z.infer<typeof childRowSchema>
export type FeatureRow = z.infer<typeof featureRowSchema>

/** Loosened shape every parsed row is treated as internally, since the four
 *  schemas above differ only in whether `parentCode`/`featureStatus` are
 *  present — narrower than a discriminated union, but this module never
 *  needs to distinguish them by type, only by the `kind` it's already
 *  branching on. */
interface ParsedCatalogRow {
  code: string
  name: string
  description: string
  active: boolean
  displayOrder: number
  parentCode?: string | null
  featureStatus?: 'new' | 'existing'
}

interface ExistingCatalogRow {
  id: string
  name: string
  description: string
  active: boolean
  displayOrder: number
  /** Parent's own code (trimmed/uppercased), resolved via a join on
   *  `parent_id` — null for verticals and for any row somehow left parentless. */
  parentCode: string | null
  /** Only meaningful for kind === 'features'; undefined otherwise. */
  featureStatus?: 'new' | 'existing'
}

export interface CatalogRows {
  verticals: unknown[]
  products: unknown[]
  modules: unknown[]
  features: unknown[]
}

export interface CatalogPreview {
  verticals: ImportRowResult[]
  products: ImportRowResult[]
  modules: ImportRowResult[]
  features: ImportRowResult[]
}

function schemaFor(kind: CatalogKind) {
  if (kind === 'verticals') return verticalRowSchema
  if (kind === 'features') return featureRowSchema
  return childRowSchema
}

function safeCode(raw: unknown): string {
  if (raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).code === 'string') {
    const code = (raw as Record<string, unknown>).code as string
    if (code.trim() !== '') return code.trim().toUpperCase()
  }
  return ''
}

function safeParentCode(raw: unknown): string | null {
  if (raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).parentCode === 'string') {
    const parentCode = (raw as Record<string, unknown>).parentCode as string
    if (parentCode.trim() !== '') return parentCode.trim().toUpperCase()
  }
  return null
}

async function fetchExisting(client: { query: Function }, kind: CatalogKind): Promise<Map<string, ExistingCatalogRow>> {
  const result = await client.query(
    `SELECT c.id, c.code, c.name, c.description, c.active, c.display_order, c.extra, p.code AS parent_code
     FROM commercial_masters c
     LEFT JOIN commercial_masters p ON p.id = c.parent_id
     WHERE c.master_key = $1`,
    [kind],
  )
  const map = new Map<string, ExistingCatalogRow>()
  for (const row of result.rows) {
    map.set(row.code.trim().toUpperCase(), {
      id: row.id,
      name: row.name,
      description: row.description,
      active: row.active,
      displayOrder: row.display_order,
      parentCode: row.parent_code ? String(row.parent_code).trim().toUpperCase() : null,
      featureStatus: kind === 'features' ? (row.extra?.status ?? 'new') : undefined,
    })
  }
  return map
}

function buildDiffs(kind: CatalogKind, row: ParsedCatalogRow, existing: ExistingCatalogRow): ImportFieldDiff[] {
  const diffs: ImportFieldDiff[] = []
  if (row.name !== existing.name) diffs.push({ field: 'name', oldValue: existing.name, newValue: row.name })
  if (row.description !== existing.description) diffs.push({ field: 'description', oldValue: existing.description, newValue: row.description })
  if (row.active !== existing.active) diffs.push({ field: 'active', oldValue: existing.active, newValue: row.active })
  if (row.displayOrder !== existing.displayOrder) diffs.push({ field: 'displayOrder', oldValue: existing.displayOrder, newValue: row.displayOrder })
  if (kind !== 'verticals') {
    const rowParentCode = (row.parentCode ?? '').trim().toUpperCase()
    if (rowParentCode !== (existing.parentCode ?? '')) {
      diffs.push({ field: 'parentCode', oldValue: existing.parentCode, newValue: rowParentCode })
    }
  }
  if (kind === 'features' && row.featureStatus !== existing.featureStatus) {
    diffs.push({ field: 'featureStatus', oldValue: existing.featureStatus, newValue: row.featureStatus })
  }
  return diffs
}

/** Classifies one sheet. `validParentCodes` is the set of codes (existing DB
 *  rows for the parent kind, plus this same upload's own non-rejected rows
 *  for that kind) a row's Parent Code may resolve against — `null` for
 *  Verticals, which have no parent to resolve. Uses `resolveTreeReferences`
 *  (Task 7) even though cross-sheet resolution here never needs more than
 *  one pass (the parent sheet is always fully classified before its child
 *  sheet runs), so a "forward reference" can only mean "references a row
 *  later in the parent sheet's own upload order" — the same deferred-resolve
 *  mechanics the design calls for, reused rather than hand-rolled again. */
function classifySheet(
  rawRows: unknown[],
  kind: CatalogKind,
  existingByKey: Map<string, ExistingCatalogRow>,
  validParentCodes: Set<string> | null,
): ImportRowResult[] {
  const schema = schemaFor(kind)

  let unresolvedParents = new Set<number>()
  if (validParentCodes) {
    const { unresolved } = resolveTreeReferences({
      rows: rawRows,
      getOwnKey: safeCode,
      getParentKey: safeParentCode,
      existingKeys: validParentCodes,
    })
    unresolvedParents = new Set(unresolved)
  }

  return classifyRows<unknown, ExistingCatalogRow>({
    rows: rawRows,
    getBusinessKey: (raw, index) => {
      const parsed = schema.safeParse(raw)
      if (parsed.success) return (parsed.data as ParsedCatalogRow).code.toUpperCase()
      if (typeof raw !== 'object' || raw === null) return null
      const rawCode = (raw as Record<string, unknown>).code
      if (typeof rawCode === 'string' && rawCode.trim() !== '') return rawCode.trim().toUpperCase()
      // Blank/missing/non-string code: still a distinct, valid row — key it
      // by its own position so it reaches validateRow (and gets the precise
      // "Code is required" message) instead of being silently swallowed as
      // a "duplicate" of some other row that also happens to have no code.
      return `__row_${index}__`
    },
    existingByKey,
    diffFields: (raw, existing) => {
      const row = schema.parse(raw) as unknown as ParsedCatalogRow
      return buildDiffs(kind, row, existing)
    },
    validateRow: (raw, index) => {
      const parsed = schema.safeParse(raw)
      const errors = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      if (unresolvedParents.has(index)) {
        const parentLabel = PARENT_LABEL[kind as Exclude<CatalogKind, 'verticals'>]
        const code = safeParentCode(raw)
        errors.push(`No such ${parentLabel} code: ${code ?? '(blank)'}`)
      }
      return errors
    },
  })
}

/** Codes (existing DB rows for `kind`, plus this upload's own non-rejected
 *  rows for `kind`) that are valid targets for a child sheet's Parent Code —
 *  a row rejected at this level (bad schema, unresolved parent of its own)
 *  is not a valid parent for the level below it, so rejection cascades. */
function validParentCodesFor(existingByKey: Map<string, ExistingCatalogRow>, preview: ImportRowResult[]): Set<string> {
  const codes = new Set(existingByKey.keys())
  for (const result of preview) {
    if (result.action !== 'reject') codes.add(result.businessKey)
  }
  return codes
}

export async function validateCatalogRows(client: { query: Function }, rows: CatalogRows): Promise<CatalogPreview> {
  const existingVerticals = await fetchExisting(client, 'verticals')
  const existingProducts = await fetchExisting(client, 'products')
  const existingModules = await fetchExisting(client, 'modules')
  const existingFeatures = await fetchExisting(client, 'features')

  const verticalsPreview = classifySheet(rows.verticals, 'verticals', existingVerticals, null)
  const validVerticalCodes = validParentCodesFor(existingVerticals, verticalsPreview)

  const productsPreview = classifySheet(rows.products, 'products', existingProducts, validVerticalCodes)
  const validProductCodes = validParentCodesFor(existingProducts, productsPreview)

  const modulesPreview = classifySheet(rows.modules, 'modules', existingModules, validProductCodes)
  const validModuleCodes = validParentCodesFor(existingModules, modulesPreview)

  const featuresPreview = classifySheet(rows.features, 'features', existingFeatures, validModuleCodes)

  return {
    verticals: verticalsPreview.map((r) => ({ ...r, sheet: 'verticals' })),
    products: productsPreview.map((r) => ({ ...r, sheet: 'products' })),
    modules: modulesPreview.map((r) => ({ ...r, sheet: 'modules' })),
    features: featuresPreview.map((r) => ({ ...r, sheet: 'features' })),
  }
}

async function fetchCodeToId(client: { query: Function }, kind: CatalogKind): Promise<Map<string, string>> {
  const result = await client.query(`SELECT id, code FROM commercial_masters WHERE master_key=$1`, [kind])
  const map = new Map<string, string>()
  for (const row of result.rows) map.set(String(row.code).trim().toUpperCase(), row.id)
  return map
}

export async function commitCatalogRows(
  client: { query: Function },
  rows: CatalogRows,
  preview: CatalogPreview,
): Promise<void> {
  // One code->id map per kind, fetched fresh from the database (not from
  // `preview`, which never carries ids for not-yet-created rows) and kept
  // up to date as this function inserts new rows level by level — a child
  // sheet can then resolve its Parent Code to the real id of a row created
  // earlier in this same commit. An existing parent that's merely being
  // *updated* in this same batch keeps its id (updates never change a row's
  // id), so an already-committed child's `parent_id` is never orphaned by
  // its parent's own update — matched purely by business key (code), never
  // re-derived from a renamed/re-resolved parent.
  const codeToId = new Map<CatalogKind, Map<string, string>>()
  for (const kind of CATALOG_KINDS) codeToId.set(kind, await fetchCodeToId(client, kind))

  for (const kind of CATALOG_KINDS) {
    const kindRows = rows[kind]
    const kindPreview = preview[kind]
    const schema = schemaFor(kind)

    for (let i = 0; i < kindRows.length; i++) {
      const result = kindPreview[i]
      if (result.action !== 'create' && result.action !== 'update') continue
      const row = schema.parse(kindRows[i]) as unknown as ParsedCatalogRow

      let parentId: string | null = null
      if (kind !== 'verticals') {
        const parentKind = PARENT_KIND[kind as Exclude<CatalogKind, 'verticals'>]
        parentId = codeToId.get(parentKind)!.get((row.parentCode ?? '').trim().toUpperCase()) ?? null
      }

      const extra = kind === 'features' ? JSON.stringify({ status: row.featureStatus ?? 'new' }) : '{}'

      if (result.action === 'create') {
        const insertResult = await client.query(
          `INSERT INTO commercial_masters (master_key, parent_id, code, name, description, active, display_order, extra)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [kind, parentId, row.code, row.name, row.description, row.active, row.displayOrder, extra],
        )
        codeToId.get(kind)!.set(row.code.trim().toUpperCase(), insertResult.rows[0].id)
      } else {
        await client.query(
          `UPDATE commercial_masters SET parent_id=$1, name=$2, description=$3, active=$4, display_order=$5, extra=$6, updated_at=now()
           WHERE master_key=$7 AND lower(trim(code))=lower(trim($8))`,
          [parentId, row.name, row.description, row.active, row.displayOrder, extra, kind, row.code],
        )
      }
    }
  }
}
