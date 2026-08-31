import { z } from 'zod'
import { classifyRows, findFuzzyCandidates } from '../engine.js'
import type { ImportFieldDiff, ImportRowResult } from '../types.js'

function normalizeCode(code: string): string {
  return code.trim().toUpperCase()
}

/** Which `commercial_masters.master_key` each FK column resolves against,
 *  and the human label used in "no such X code" rejection messages. */
const FK_COLUMNS = [
  { field: 'categoryCode', masterKey: 'skuCategories', label: 'SKU Category' },
  { field: 'featureCode', masterKey: 'features', label: 'Feature' },
  { field: 'editionCode', masterKey: 'productEditions', label: 'Product Edition' },
  { field: 'uomCode', masterKey: 'unitsOfMeasure', label: 'Unit of Measure' },
  { field: 'currencyCode', masterKey: 'currencies', label: 'Currency' },
  { field: 'taxClassCode', masterKey: 'taxClasses', label: 'Tax Class' },
  { field: 'billingTypeCode', masterKey: 'billingTypes', label: 'Billing Type' },
] as const

const LIFECYCLE_STATUSES = ['draft', 'active', 'inactive', 'retired'] as const

const numericField = (label: string) => z.number({ invalid_type_error: `${label} must be a number` }).optional().default(0)

const skuRowSchema = z.object({
  skuCode: z.string().min(1, 'SKU Code is required').trim(),
  name: z.string().min(1, 'Name is required'),
  categoryCode: z.string().min(1, 'Category Code is required').trim(),
  featureCode: z.string().min(1, 'Feature Code is required').trim(),
  // Blank Edition Code defaults to the STD edition (resolved by code lookup
  // at validation time, matching the frontend's own STANDARD_EDITION_ID
  // fallback — src/modules/commercial-calculator/seed-defaults.ts).
  editionCode: z.string().trim().optional().default('').transform((v) => (v === '' ? 'STD' : v)),
  uomCode: z.string().min(1, 'UOM Code is required').trim(),
  currencyCode: z.string().min(1, 'Currency Code is required').trim(),
  taxClassCode: z.string().min(1, 'Tax Class Code is required').trim(),
  billingTypeCode: z.string().min(1, 'Billing Type Code is required').trim(),
  activeFrom: z.string().min(1, 'Active From is required'),
  activeTill: z.string().nullable().optional().default(null),
  lifecycleStatus: z.enum(LIFECYCLE_STATUSES).optional().default('draft'),
  isSellable: z.boolean().optional().default(true),
  displayOrder: z.number().optional().default(0),
  baseSoftwareCost: numericField('baseSoftwareCost'),
  implementationCostPerMM: numericField('implementationCostPerMM'),
  integrationCost: numericField('integrationCost'),
  thirdPartyCost: numericField('thirdPartyCost'),
  hardwareCost: numericField('hardwareCost'),
  cloudCost: numericField('cloudCost'),
  supportCost: numericField('supportCost'),
  trainingCost: numericField('trainingCost'),
  internalPrice: numericField('internalPrice'),
  floorPrice: numericField('floorPrice'),
  partnerPrice: numericField('partnerPrice'),
  governmentPrice: numericField('governmentPrice'),
  enterprisePrice: numericField('enterprisePrice'),
  corporatePrice: numericField('corporatePrice'),
  listPrice: numericField('listPrice'),
  // No default — required per the DB's own NOT NULL constraint.
  minimumAllowedPrice: z.number({ invalid_type_error: 'minimumAllowedPrice must be a number' }),
  maximumDiscountPercent: z.number().optional().default(90),
})
export type SkuRow = z.infer<typeof skuRowSchema>

interface ExistingSku {
  id: string
  name: string
  categoryCode: string
  featureCode: string
  editionCode: string
  uomCode: string
  currencyCode: string
  taxClassCode: string
  billingTypeCode: string
  activeFrom: string
  activeTill: string | null
  lifecycleStatus: string
  isSellable: boolean
  displayOrder: number
  baseSoftwareCost: number
  implementationCostPerMM: number
  integrationCost: number
  thirdPartyCost: number
  hardwareCost: number
  cloudCost: number
  supportCost: number
  trainingCost: number
  internalPrice: number
  floorPrice: number
  partnerPrice: number
  governmentPrice: number
  enterprisePrice: number
  corporatePrice: number
  listPrice: number
  minimumAllowedPrice: number
  maximumDiscountPercent: number
}

/** code -> id, per master_key, for every FK a SKU row needs. SKUs never
 *  reference each other or forward-reference rows in the same file — every
 *  FK target is a Commercial Masters row that must already exist in the
 *  database, so a single upfront fetch (no deferred-resolution loop) is
 *  enough, unlike the self-referencing tree domains. */
async function fetchMasterIdsByCode(client: { query: Function }): Promise<Map<string, Map<string, string>>> {
  const result = await client.query(`SELECT master_key, code, id FROM commercial_masters`)
  const byMasterKey = new Map<string, Map<string, string>>()
  for (const row of result.rows) {
    const inner = byMasterKey.get(row.master_key) ?? new Map<string, string>()
    inner.set(normalizeCode(row.code), row.id)
    byMasterKey.set(row.master_key, inner)
  }
  return byMasterKey
}

async function fetchExisting(client: { query: Function }): Promise<Map<string, ExistingSku>> {
  const result = await client.query(
    `SELECT s.*, cat.code AS category_code, feat.code AS feature_code, ed.code AS edition_code,
            uom.code AS uom_code, cur.code AS currency_code, tax.code AS tax_class_code, bill.code AS billing_type_code
     FROM commercial_skus s
     JOIN commercial_masters cat ON cat.id = s.category_id
     JOIN commercial_masters feat ON feat.id = s.feature_id
     JOIN commercial_masters ed ON ed.id = s.edition_id
     JOIN commercial_masters uom ON uom.id = s.uom_id
     JOIN commercial_masters cur ON cur.id = s.currency_id
     JOIN commercial_masters tax ON tax.id = s.tax_class_id
     JOIN commercial_masters bill ON bill.id = s.billing_type_id`,
  )
  const map = new Map<string, ExistingSku>()
  for (const row of result.rows) {
    map.set(normalizeCode(row.sku_code), {
      id: row.id,
      name: row.name,
      categoryCode: normalizeCode(row.category_code),
      featureCode: normalizeCode(row.feature_code),
      editionCode: normalizeCode(row.edition_code),
      uomCode: normalizeCode(row.uom_code),
      currencyCode: normalizeCode(row.currency_code),
      taxClassCode: normalizeCode(row.tax_class_code),
      billingTypeCode: normalizeCode(row.billing_type_code),
      activeFrom: row.active_from,
      activeTill: row.active_till,
      lifecycleStatus: row.lifecycle_status,
      isSellable: row.is_sellable,
      displayOrder: row.display_order,
      baseSoftwareCost: Number(row.base_software_cost),
      implementationCostPerMM: Number(row.implementation_cost_per_mm),
      integrationCost: Number(row.integration_cost),
      thirdPartyCost: Number(row.third_party_cost),
      hardwareCost: Number(row.hardware_cost),
      cloudCost: Number(row.cloud_cost),
      supportCost: Number(row.support_cost),
      trainingCost: Number(row.training_cost),
      internalPrice: Number(row.internal_price),
      floorPrice: Number(row.floor_price),
      partnerPrice: Number(row.partner_price),
      governmentPrice: Number(row.government_price),
      enterprisePrice: Number(row.enterprise_price),
      corporatePrice: Number(row.corporate_price),
      listPrice: Number(row.list_price),
      minimumAllowedPrice: Number(row.minimum_allowed_price),
      maximumDiscountPercent: Number(row.maximum_discount_percent),
    })
  }
  return map
}

const NUMERIC_DIFF_FIELDS = [
  'baseSoftwareCost', 'implementationCostPerMM', 'integrationCost', 'thirdPartyCost', 'hardwareCost',
  'cloudCost', 'supportCost', 'trainingCost', 'internalPrice', 'floorPrice', 'partnerPrice',
  'governmentPrice', 'enterprisePrice', 'corporatePrice', 'listPrice', 'minimumAllowedPrice', 'maximumDiscountPercent',
] as const

export async function validateSkuRows(client: { query: Function }, rawRows: unknown[]): Promise<ImportRowResult[]> {
  const mastersByKey = await fetchMasterIdsByCode(client)
  const existingByKey = await fetchExisting(client)

  return classifyRows<unknown, ExistingSku>({
    rows: rawRows,
    getBusinessKey: (raw, index) => {
      const parsed = skuRowSchema.safeParse(raw)
      if (parsed.success) return normalizeCode(parsed.data.skuCode)
      if (typeof raw !== 'object' || raw === null) return `__row_${index}__`
      const rawCode = (raw as Record<string, unknown>).skuCode
      if (typeof rawCode === 'string' && rawCode.trim() !== '') return normalizeCode(rawCode)
      // Blank/missing/non-string SKU Code: still a distinct, valid row — key
      // it by its own position so it reaches validateRow (and gets the
      // precise "SKU Code is required" message) instead of being silently
      // swallowed as a false duplicate of some other blank-coded row.
      return `__row_${index}__`
    },
    existingByKey,
    diffFields: (raw, existing) => {
      const row = skuRowSchema.parse(raw)
      const diffs: ImportFieldDiff[] = []
      if (row.name !== existing.name) diffs.push({ field: 'name', oldValue: existing.name, newValue: row.name })
      if (normalizeCode(row.categoryCode) !== existing.categoryCode) diffs.push({ field: 'categoryCode', oldValue: existing.categoryCode, newValue: normalizeCode(row.categoryCode) })
      if (normalizeCode(row.featureCode) !== existing.featureCode) diffs.push({ field: 'featureCode', oldValue: existing.featureCode, newValue: normalizeCode(row.featureCode) })
      if (normalizeCode(row.editionCode) !== existing.editionCode) diffs.push({ field: 'editionCode', oldValue: existing.editionCode, newValue: normalizeCode(row.editionCode) })
      if (normalizeCode(row.uomCode) !== existing.uomCode) diffs.push({ field: 'uomCode', oldValue: existing.uomCode, newValue: normalizeCode(row.uomCode) })
      if (normalizeCode(row.currencyCode) !== existing.currencyCode) diffs.push({ field: 'currencyCode', oldValue: existing.currencyCode, newValue: normalizeCode(row.currencyCode) })
      if (normalizeCode(row.taxClassCode) !== existing.taxClassCode) diffs.push({ field: 'taxClassCode', oldValue: existing.taxClassCode, newValue: normalizeCode(row.taxClassCode) })
      if (normalizeCode(row.billingTypeCode) !== existing.billingTypeCode) diffs.push({ field: 'billingTypeCode', oldValue: existing.billingTypeCode, newValue: normalizeCode(row.billingTypeCode) })
      if (row.activeFrom !== existing.activeFrom) diffs.push({ field: 'activeFrom', oldValue: existing.activeFrom, newValue: row.activeFrom })
      if (row.activeTill !== existing.activeTill) diffs.push({ field: 'activeTill', oldValue: existing.activeTill, newValue: row.activeTill })
      if (row.lifecycleStatus !== existing.lifecycleStatus) diffs.push({ field: 'lifecycleStatus', oldValue: existing.lifecycleStatus, newValue: row.lifecycleStatus })
      if (row.isSellable !== existing.isSellable) diffs.push({ field: 'isSellable', oldValue: existing.isSellable, newValue: row.isSellable })
      if (row.displayOrder !== existing.displayOrder) diffs.push({ field: 'displayOrder', oldValue: existing.displayOrder, newValue: row.displayOrder })
      for (const field of NUMERIC_DIFF_FIELDS) {
        if (row[field] !== existing[field]) diffs.push({ field, oldValue: existing[field], newValue: row[field] })
      }
      return diffs
    },
    validateRow: (raw) => {
      const parsed = skuRowSchema.safeParse(raw)
      if (!parsed.success) return { errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
      const row = parsed.data
      const errors: string[] = []
      let candidates: { key: string; score: number }[] | undefined
      for (const fk of FK_COLUMNS) {
        const codeValue = row[fk.field]
        const masterMap = mastersByKey.get(fk.masterKey)
        if (!masterMap || !masterMap.has(normalizeCode(codeValue))) {
          const suggestions = masterMap ? findFuzzyCandidates(normalizeCode(codeValue), masterMap.keys()) : []
          if (suggestions.length > 0) candidates = [...(candidates ?? []), ...suggestions].slice(0, 3)
          errors.push(`no such ${fk.label.toLowerCase()} code: ${codeValue}`)
        }
      }
      return { errors, needsReview: (candidates?.length ?? 0) > 0, candidates }
    },
  })
}

export async function commitSkuRows(
  client: { query: Function },
  rawRows: unknown[],
  preview: ImportRowResult[],
): Promise<void> {
  const mastersByKey = await fetchMasterIdsByCode(client)

  for (let i = 0; i < rawRows.length; i++) {
    const result = preview[i]
    if (!result || (result.action !== 'create' && result.action !== 'update')) continue
    const row = skuRowSchema.parse(rawRows[i])

    // Guaranteed defined: validateSkuRows already rejected any row whose FK
    // codes don't resolve against the database.
    const categoryId = mastersByKey.get('skuCategories')!.get(normalizeCode(row.categoryCode))!
    const featureId = mastersByKey.get('features')!.get(normalizeCode(row.featureCode))!
    const editionId = mastersByKey.get('productEditions')!.get(normalizeCode(row.editionCode))!
    const uomId = mastersByKey.get('unitsOfMeasure')!.get(normalizeCode(row.uomCode))!
    const currencyId = mastersByKey.get('currencies')!.get(normalizeCode(row.currencyCode))!
    const taxClassId = mastersByKey.get('taxClasses')!.get(normalizeCode(row.taxClassCode))!
    const billingTypeId = mastersByKey.get('billingTypes')!.get(normalizeCode(row.billingTypeCode))!

    const values = [
      row.skuCode, row.name, categoryId, featureId, editionId, uomId, currencyId, taxClassId, billingTypeId,
      row.activeFrom, row.activeTill, row.lifecycleStatus, row.isSellable, row.displayOrder,
      row.baseSoftwareCost, row.implementationCostPerMM, row.integrationCost, row.thirdPartyCost,
      row.hardwareCost, row.cloudCost, row.supportCost, row.trainingCost,
      row.internalPrice, row.floorPrice, row.partnerPrice, row.governmentPrice,
      row.enterprisePrice, row.corporatePrice, row.listPrice,
      row.minimumAllowedPrice, row.maximumDiscountPercent,
    ]

    if (result.action === 'create') {
      await client.query(
        `INSERT INTO commercial_skus (
           sku_code, name, category_id, feature_id, edition_id, uom_id, currency_id, tax_class_id, billing_type_id,
           active_from, active_till, lifecycle_status, is_sellable, display_order,
           base_software_cost, implementation_cost_per_mm, integration_cost, third_party_cost,
           hardware_cost, cloud_cost, support_cost, training_cost,
           internal_price, floor_price, partner_price, government_price,
           enterprise_price, corporate_price, list_price,
           minimum_allowed_price, maximum_discount_percent
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)`,
        values,
      )
    } else {
      await client.query(
        `UPDATE commercial_skus SET
           name=$2, category_id=$3, feature_id=$4, edition_id=$5, uom_id=$6, currency_id=$7, tax_class_id=$8, billing_type_id=$9,
           active_from=$10, active_till=$11, lifecycle_status=$12, is_sellable=$13, display_order=$14,
           base_software_cost=$15, implementation_cost_per_mm=$16, integration_cost=$17, third_party_cost=$18,
           hardware_cost=$19, cloud_cost=$20, support_cost=$21, training_cost=$22,
           internal_price=$23, floor_price=$24, partner_price=$25, government_price=$26,
           enterprise_price=$27, corporate_price=$28, list_price=$29,
           minimum_allowed_price=$30, maximum_discount_percent=$31, updated_at=now()
         WHERE lower(trim(sku_code))=lower(trim($1))`,
        values,
      )
    }
  }
}
