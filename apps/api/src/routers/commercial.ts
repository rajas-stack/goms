import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { publicProcedure, protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isForeignKeyViolation, isUniqueViolation } from '../db-errors.js'
import { writeAuditLog, listAuditLogs } from '../lib/auditLog.js'
import {
  buildSkuCode, MASTER_CHILD_OF, MASTER_EXTRA_FIELDS, MASTER_PARENT_FIELD, findMasterCodeClash,
  SKU_SENSITIVE_FIELDS, type CommercialMasterKey,
  BOQ_TRANSITIONS, LINE_STATES_CLEARED_FOR_APPROVAL, DELETABLE_BOQ_STATUSES, formatBoqNumber, type BoqStatus,
  computeLineTotal, validateLineQuantity, validateLineDiscountPct, resolveApprovalBand, freshLineApprovalState,
  effectiveUnitPrice, isAbsoluteLinePrice, discountPctForSellingPrice, conversionFactorFromRates,
} from '@goms/domain'

const masterKeySchema = z.enum([
  'verticals', 'products', 'modules', 'features', 'skuCategories', 'unitsOfMeasure',
  'productEditions', 'billingTypes', 'taxClasses', 'approvalMatrix', 'currencies', 'preSales',
])

// Returns `any` deliberately — a master row's real shape varies by `key`
// (see `MasterRowMap` in the frontend's commercial-calculator/types.ts), and
// nothing on the backend has that key at compile time. Callers on the
// frontend side (RemoteRepository) restore the precise per-key type.
function toMaster(row: any): any {
  const key = row.master_key as CommercialMasterKey
  const base: Record<string, unknown> = {
    id: row.id, code: row.code, name: row.name, description: row.description,
    active: row.active, displayOrder: row.display_order,
  }
  const parentRule = MASTER_PARENT_FIELD[key]
  if (parentRule) base[parentRule.field] = row.parent_id
  for (const field of MASTER_EXTRA_FIELDS[key]) base[field] = row.extra[field]
  return base
}

function toEditionFeature(row: any) {
  return { id: row.id, editionId: row.edition_id, featureId: row.feature_id, mandatory: row.mandatory, displayOrder: row.display_order }
}

function buildExtra(key: CommercialMasterKey, input: Record<string, any>): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  for (const field of MASTER_EXTRA_FIELDS[key]) {
    if (input[field] !== undefined) extra[field] = input[field]
  }
  return extra
}

async function assertCodeAvailable(client: any, key: string, code: string, excludeId: string | null) {
  const result = excludeId
    ? await client.query('SELECT id, code FROM commercial_masters WHERE master_key=$1 AND id<>$2', [key, excludeId])
    : await client.query('SELECT id, code FROM commercial_masters WHERE master_key=$1', [key])
  const clash = findMasterCodeClash(result.rows, code, excludeId)
  if (clash) throw new TRPCError({ code: 'CONFLICT', message: `Code "${code.trim()}" is already used by another ${key} row.` })
}

async function assertParentExists(client: any, key: CommercialMasterKey, parentId: unknown) {
  const rule = MASTER_PARENT_FIELD[key]
  if (!rule) return
  if (typeof parentId !== 'string' || !parentId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${rule.field} is required.` })
  }
  const result = await client.query('SELECT 1 FROM commercial_masters WHERE master_key=$1 AND id=$2', [rule.parentKey, parentId])
  if (!result.rows.length) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such ${rule.parentKey} row: ${parentId}` })
}

async function oneMaster(key: string, id: string) {
  const result = await pool.query('SELECT * FROM commercial_masters WHERE master_key=$1 AND id=$2', [key, id])
  return result.rows[0] ? toMaster(result.rows[0]) : null
}

const commercialMastersRouter = router({
  list: publicProcedure
    .input(z.object({ key: masterKeySchema }))
    .query(async ({ input }) => {
      const result = await pool.query('SELECT * FROM commercial_masters WHERE master_key=$1 ORDER BY display_order', [input.key])
      return result.rows.map(toMaster)
    }),

  get: publicProcedure
    .input(z.object({ key: masterKeySchema, id: z.string().uuid() }))
    .query(({ input }) => oneMaster(input.key, input.id)),

  create: protectedProcedure
    .input(z.object({
      key: masterKeySchema,
      input: z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        active: z.boolean().optional(),
        displayOrder: z.number().optional(),
      }).catchall(z.any()),
    }))
    .mutation(async ({ input: { key, input } }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await assertCodeAvailable(client, key, input.code, null)
        const parentRule = MASTER_PARENT_FIELD[key]
        if (parentRule) await assertParentExists(client, key, input[parentRule.field])

        const countResult = await client.query('SELECT COUNT(*) FROM commercial_masters WHERE master_key=$1', [key])
        const displayOrder = input.displayOrder ?? Number(countResult.rows[0].count)
        const extra = buildExtra(key, input)

        const insertResult = await client.query(
          `INSERT INTO commercial_masters (master_key, parent_id, code, name, description, active, display_order, extra)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            key, parentRule ? input[parentRule.field] : null, input.code, input.name,
            input.description ?? '', input.active ?? true, displayOrder, JSON.stringify(extra),
          ],
        )
        const row = insertResult.rows[0]

        if (key === 'currencies' && input.isBaseCurrency) {
          await client.query(
            `UPDATE commercial_masters SET extra = extra || '{"isBaseCurrency": false}'::jsonb
             WHERE master_key='currencies' AND id<>$1`,
            [row.id],
          )
        }

        await client.query('COMMIT')
        return toMaster(row)
      } catch (e) {
        await client.query('ROLLBACK')
        // assertCodeAvailable's SELECT-based check isn't atomic with this
        // INSERT — two concurrent creates for the same (key, code) can both
        // pass it. The unique index backing it (commercial_masters_key_code_idx)
        // still stops the duplicate from landing, but without this catch the
        // loser gets a raw, unhandled 23505 instead of the same friendly
        // CONFLICT the pre-check was meant to produce.
        if (isUniqueViolation(e)) throw new TRPCError({ code: 'CONFLICT', message: `Code "${input.code.trim()}" is already used by another ${key} row.` })
        throw e
      } finally {
        client.release()
      }
    }),

  update: protectedProcedure
    .input(z.object({ key: masterKeySchema, id: z.string().uuid(), patch: z.record(z.any()), changeReason: z.string().optional() }))
    .mutation(async ({ input: { key, id, patch, changeReason } }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const currentResult = await client.query('SELECT * FROM commercial_masters WHERE master_key=$1 AND id=$2 FOR UPDATE', [key, id])
        const currentRow = currentResult.rows[0]
        if (!currentRow) throw new TRPCError({ code: 'NOT_FOUND', message: `No such ${key} row: ${id}` })
        const current = toMaster(currentRow) as Record<string, any>

        if (patch.code !== undefined) await assertCodeAvailable(client, key, patch.code, id)

        const merged = { ...current, ...patch }
        const parentRule = MASTER_PARENT_FIELD[key]
        if (parentRule) await assertParentExists(client, key, merged[parentRule.field])

        // A feature's status change must carry a reason (spec parity with the
        // frontend's updateMasterLogic), and — now that commercial_audit_logs
        // exists (Phase 6) — closes the audit-log deferral Phase 4 left open.
        if (key === 'features' && patch.status !== undefined && patch.status !== current.status) {
          if (!changeReason?.trim()) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: "changeReason is required when changing a feature's status." })
          }
          await writeAuditLog(client, {
            entityType: 'feature', entityId: id, field: 'status',
            oldValue: String(current.status), newValue: String(patch.status),
            reason: changeReason, action: 'status_change',
          })
        }

        const extraPatch = buildExtra(key, patch)
        const nextExtra = { ...currentRow.extra, ...extraPatch }

        await client.query(
          `UPDATE commercial_masters SET
             parent_id=$1, code=$2, name=$3, description=$4, active=$5, display_order=$6, extra=$7, updated_at=now()
           WHERE id=$8`,
          [
            parentRule ? merged[parentRule.field] : null,
            merged.code, merged.name, merged.description, merged.active, merged.displayOrder,
            JSON.stringify(nextExtra), id,
          ],
        )

        if (key === 'currencies' && extraPatch.isBaseCurrency === true) {
          await client.query(
            `UPDATE commercial_masters SET extra = extra || '{"isBaseCurrency": false}'::jsonb
             WHERE master_key='currencies' AND id<>$1`,
            [id],
          )
        }

        await client.query('COMMIT')
        return oneMaster(key, id)
      } catch (e) {
        await client.query('ROLLBACK')
        if (isUniqueViolation(e)) throw new TRPCError({ code: 'CONFLICT', message: `Code "${String(patch.code ?? '').trim()}" is already used by another ${key} row.` })
        throw e
      } finally {
        client.release()
      }
    }),

  setActive: protectedProcedure
    .input(z.object({ key: masterKeySchema, id: z.string().uuid(), active: z.boolean() }))
    .mutation(({ input }) =>
      pool.query('UPDATE commercial_masters SET active=$1, updated_at=now() WHERE master_key=$2 AND id=$3', [input.active, input.key, input.id])
        .then(() => undefined),
    ),

  delete: protectedProcedure
    .input(z.object({ key: masterKeySchema, id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      // MASTER_CHILD_OF only flags kinds with a real child concept (verticals/
      // products/modules); every child's link is the same self-referencing
      // parent_id column regardless of key, so counting by parent_id alone —
      // without re-deriving the child's key — is sufficient.
      if (MASTER_CHILD_OF[input.key]) {
        const childResult = await pool.query('SELECT COUNT(*) FROM commercial_masters WHERE parent_id=$1', [input.id])
        const childCount = Number(childResult.rows[0].count)
        if (childCount > 0) {
          throw new TRPCError({ code: 'CONFLICT', message: `Cannot delete this ${input.key} row — ${childCount} row(s) still reference it.` })
        }
      }
      // Unlike the self-referencing parent/child check above, this master
      // row can also be referenced across tables — commercial_skus' 7 FK
      // columns (RESTRICT by default) and commercial_boqs.vertical_id
      // (RESTRICT). Without this pre-check those deletes still fail (the DB
      // constraint holds either way), just as a raw, unhandled Postgres
      // 23503 instead of this router's usual friendly CONFLICT — the same
      // gap skus.delete already closes for BOM/BOQ-line-item references.
      const skuColumn = MASTER_KEY_TO_SKU_COLUMN[input.key]
      if (skuColumn) {
        const inUse = await pool.query(`SELECT 1 FROM commercial_skus WHERE ${skuColumn}=$1 LIMIT 1`, [input.id])
        if (inUse.rows.length) {
          throw new TRPCError({ code: 'CONFLICT', message: `Cannot delete this ${input.key} row — it is still referenced by at least one SKU.` })
        }
      }
      if (input.key === 'verticals') {
        const inUse = await pool.query('SELECT 1 FROM commercial_boqs WHERE vertical_id=$1 LIMIT 1', [input.id])
        if (inUse.rows.length) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete this vertical — it is still referenced by at least one BOQ.' })
        }
      }
      // commercial_boqs.currency is deliberately plain TEXT, not an FK
      // (commercial-boq.sql's own comment: resolved at the application
      // layer) — so unlike every other case above, the DB gives no RESTRICT
      // backstop at all here. Without this explicit check, deleting a
      // currency master still in use by a draft BOQ would silently succeed
      // and only surface later as a BAD_REQUEST the next time anyone prices
      // that BOQ (withLiveDraftPricing's currencyRateByCode lookup).
      if (input.key === 'currencies') {
        const codeResult = await pool.query('SELECT code FROM commercial_masters WHERE master_key=$1 AND id=$2', [input.key, input.id])
        const code = codeResult.rows[0]?.code
        if (code) {
          const inUse = await pool.query('SELECT 1 FROM commercial_boqs WHERE currency=$1 LIMIT 1', [code])
          if (inUse.rows.length) {
            throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete this currency — it is still referenced by at least one BOQ.' })
          }
        }
      }
      try {
        await pool.query('DELETE FROM commercial_masters WHERE master_key=$1 AND id=$2', [input.key, input.id])
      } catch (e) {
        if (isForeignKeyViolation(e)) throw new TRPCError({ code: 'CONFLICT', message: `Cannot delete this ${input.key} row — it is still referenced elsewhere.` })
        throw e
      }
    }),

  listEditionFeatures: publicProcedure
    .input(z.object({ editionId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await pool.query('SELECT * FROM edition_features WHERE edition_id=$1 ORDER BY display_order', [input.editionId])
      return result.rows.map(toEditionFeature)
    }),

  setEditionFeatures: protectedProcedure
    .input(z.object({
      editionId: z.string().uuid(),
      rows: z.array(z.object({ featureId: z.string().uuid(), mandatory: z.boolean() })),
    }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('DELETE FROM edition_features WHERE edition_id=$1', [input.editionId])
        for (let i = 0; i < input.rows.length; i++) {
          const r = input.rows[i]
          await client.query(
            'INSERT INTO edition_features (edition_id, feature_id, mandatory, display_order) VALUES ($1,$2,$3,$4)',
            [input.editionId, r.featureId, r.mandatory, i],
          )
        }
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
})

// --- Commercial SKU Catalog (spec §6.3/§7/§14) -----------------------------

const pricingLevelKeySchema = z.enum(['internal', 'floor', 'partner', 'government', 'enterprise', 'corporate'])
const lifecycleStatusSchema = z.enum(['draft', 'active', 'inactive', 'retired'])
const skuPricingLevelSettingSchema = z.object({ level: pricingLevelKeySchema, maximumDiscountPercent: z.number() })

function toSku(row: any) {
  return {
    id: row.id, skuCode: row.sku_code, name: row.name,
    categoryId: row.category_id, featureId: row.feature_id, editionId: row.edition_id,
    uomId: row.uom_id, currencyId: row.currency_id, taxClassId: row.tax_class_id, billingTypeId: row.billing_type_id,
    activeFrom: row.active_from, activeTill: row.active_till,
    lifecycleStatus: row.lifecycle_status, isSellable: row.is_sellable, displayOrder: row.display_order,
    baseSoftwareCost: row.base_software_cost, implementationCostPerMM: row.implementation_cost_per_mm,
    integrationCost: row.integration_cost, thirdPartyCost: row.third_party_cost,
    hardwareCost: row.hardware_cost, cloudCost: row.cloud_cost, supportCost: row.support_cost, trainingCost: row.training_cost,
    internalPrice: row.internal_price, floorPrice: row.floor_price, partnerPrice: row.partner_price,
    governmentPrice: row.government_price, enterprisePrice: row.enterprise_price, corporatePrice: row.corporate_price,
    listPrice: row.list_price,
    minimumAllowedPrice: row.minimum_allowed_price, maximumDiscountPercent: row.maximum_discount_percent,
    selectedPricingLevels: row.selected_pricing_levels,
    createdAt: row.created_at.toISOString(), createdBy: row.created_by,
  }
}

function toBomItem(row: any) {
  return {
    id: row.id, parentSkuId: row.parent_sku_id, componentSkuId: row.component_sku_id,
    mandatory: row.mandatory, quantity: row.quantity, notes: row.notes,
  }
}

async function assertMasterExists(client: any, key: CommercialMasterKey, id: string, label: string) {
  const result = await client.query('SELECT 1 FROM commercial_masters WHERE master_key=$1 AND id=$2', [key, id])
  if (!result.rows.length) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such ${label}: ${id}` })
}

/** Walks featureId -> module -> product -> vertical via `commercial_masters.parent_id`
 *  (the frontend's `resolveSkuHierarchy` does the same walk over its own
 *  in-memory arrays — the traversal itself isn't shared since one's an array
 *  scan and the other's a DB query, but the resulting `buildSkuCode` format
 *  call is, via `@goms/domain`). */
async function resolveFeatureHierarchy(client: any, featureId: string) {
  const featureResult = await client.query('SELECT * FROM commercial_masters WHERE id=$1 AND master_key=$2', [featureId, 'features'])
  const feature = featureResult.rows[0]
  if (!feature) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such feature: ${featureId}` })
  const moduleResult = await client.query('SELECT * FROM commercial_masters WHERE id=$1 AND master_key=$2', [feature.parent_id, 'modules'])
  const module_ = moduleResult.rows[0]
  if (!module_) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such module: ${feature.parent_id}` })
  const productResult = await client.query('SELECT * FROM commercial_masters WHERE id=$1 AND master_key=$2', [module_.parent_id, 'products'])
  const product = productResult.rows[0]
  if (!product) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such product: ${module_.parent_id}` })
  const verticalResult = await client.query('SELECT * FROM commercial_masters WHERE id=$1 AND master_key=$2', [product.parent_id, 'verticals'])
  const vertical = verticalResult.rows[0]
  if (!vertical) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such vertical: ${product.parent_id}` })
  return { feature, module: module_, product, vertical }
}

/** The in-memory `STANDARD_EDITION_ID` ('ped_standard') is a fixed frontend
 *  seed id with no Postgres equivalent — the backend instead resolves "the"
 *  standard edition by its code ('STD'), the same code the seed row and
 *  `commercial.test.ts` both already use to mean "the standard edition".
 *  Deviation from the in-memory implementation, forced by there being no
 *  fixed-id seed data on this side; documented per this migration's own
 *  requirement to call out such gaps rather than leave them silent. */
async function resolveStandardEditionId(client: any): Promise<string> {
  const result = await client.query(`SELECT id FROM commercial_masters WHERE master_key='productEditions' AND lower(code)='std' LIMIT 1`)
  if (!result.rows[0]) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No standard (STD) product edition is configured.' })
  return result.rows[0].id
}

const createSkuInputShape = {
  name: z.string().min(1),
  categoryId: z.string().uuid(),
  featureId: z.string().uuid(),
  editionId: z.string().uuid().optional(),
  uomId: z.string().uuid(),
  currencyId: z.string().uuid(),
  taxClassId: z.string().uuid(),
  billingTypeId: z.string().uuid(),
  activeFrom: z.string().min(1),
  activeTill: z.string().nullable(),
  lifecycleStatus: lifecycleStatusSchema.optional(),
  isSellable: z.boolean().optional(),
  displayOrder: z.number().optional(),
  baseSoftwareCost: z.number(), implementationCostPerMM: z.number(), integrationCost: z.number(), thirdPartyCost: z.number(),
  hardwareCost: z.number(), cloudCost: z.number(), supportCost: z.number(), trainingCost: z.number(),
  internalPrice: z.number(), floorPrice: z.number(), partnerPrice: z.number(), governmentPrice: z.number(),
  enterprisePrice: z.number(), corporatePrice: z.number(), listPrice: z.number(),
  minimumAllowedPrice: z.number().optional(),
  maximumDiscountPercent: z.number().optional(),
  selectedPricingLevels: z.array(skuPricingLevelSettingSchema).optional(),
}

const skuPatchShape = {
  name: z.string().min(1).optional(),
  categoryId: z.string().uuid().optional(),
  featureId: z.string().uuid().optional(),
  editionId: z.string().uuid().optional(),
  uomId: z.string().uuid().optional(),
  currencyId: z.string().uuid().optional(),
  taxClassId: z.string().uuid().optional(),
  billingTypeId: z.string().uuid().optional(),
  activeFrom: z.string().min(1).optional(),
  activeTill: z.string().nullable().optional(),
  lifecycleStatus: lifecycleStatusSchema.optional(),
  isSellable: z.boolean().optional(),
  displayOrder: z.number().optional(),
  baseSoftwareCost: z.number().optional(), implementationCostPerMM: z.number().optional(),
  integrationCost: z.number().optional(), thirdPartyCost: z.number().optional(),
  hardwareCost: z.number().optional(), cloudCost: z.number().optional(),
  supportCost: z.number().optional(), trainingCost: z.number().optional(),
  internalPrice: z.number().optional(), floorPrice: z.number().optional(), partnerPrice: z.number().optional(),
  governmentPrice: z.number().optional(), enterprisePrice: z.number().optional(), corporatePrice: z.number().optional(),
  listPrice: z.number().optional(),
  minimumAllowedPrice: z.number().optional(),
  maximumDiscountPercent: z.number().optional(),
  selectedPricingLevels: z.array(skuPricingLevelSettingSchema).optional(),
}

const skuColumnFor: Record<string, string> = {
  name: 'name', categoryId: 'category_id', featureId: 'feature_id', editionId: 'edition_id',
  uomId: 'uom_id', currencyId: 'currency_id', taxClassId: 'tax_class_id', billingTypeId: 'billing_type_id',
  activeFrom: 'active_from', activeTill: 'active_till',
  lifecycleStatus: 'lifecycle_status', isSellable: 'is_sellable', displayOrder: 'display_order',
  baseSoftwareCost: 'base_software_cost', implementationCostPerMM: 'implementation_cost_per_mm',
  integrationCost: 'integration_cost', thirdPartyCost: 'third_party_cost',
  hardwareCost: 'hardware_cost', cloudCost: 'cloud_cost', supportCost: 'support_cost', trainingCost: 'training_cost',
  internalPrice: 'internal_price', floorPrice: 'floor_price', partnerPrice: 'partner_price',
  governmentPrice: 'government_price', enterprisePrice: 'enterprise_price', corporatePrice: 'corporate_price',
  listPrice: 'list_price', minimumAllowedPrice: 'minimum_allowed_price', maximumDiscountPercent: 'maximum_discount_percent',
  selectedPricingLevels: 'selected_pricing_levels',
}
const skuJsonColumns = new Set(['selectedPricingLevels'])
const skuFkChecks: [string, CommercialMasterKey, string][] = [
  ['editionId', 'productEditions', 'product edition'],
  ['categoryId', 'skuCategories', 'SKU category'],
  ['featureId', 'features', 'feature'],
  ['uomId', 'unitsOfMeasure', 'unit of measure'],
  ['currencyId', 'currencies', 'currency'],
  ['taxClassId', 'taxClasses', 'tax class'],
  ['billingTypeId', 'billingTypes', 'billing type'],
]

// The column-name half of skuFkChecks, keyed by master key instead of SKU
// field — used by commercialMastersRouter.delete to check whether a master
// row is still referenced by any SKU before deleting it (skuFkChecks itself
// is used the other direction, validating a SKU's inputs against its
// masters). snake_case here since it's used directly in a SQL identifier
// position, unlike skuFkChecks' camelCase field names.
const MASTER_KEY_TO_SKU_COLUMN: Partial<Record<CommercialMasterKey, string>> = {
  productEditions: 'edition_id', skuCategories: 'category_id', features: 'feature_id',
  unitsOfMeasure: 'uom_id', currencies: 'currency_id', taxClasses: 'tax_class_id', billingTypes: 'billing_type_id',
}

const commercialSkusRouter = router({
  list: protectedReadProcedure.query(async () => {
    const result = await pool.query('SELECT * FROM commercial_skus ORDER BY display_order')
    return result.rows.map(toSku)
  }),

  get: protectedReadProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query('SELECT * FROM commercial_skus WHERE id=$1', [input.id])
    return result.rows[0] ? toSku(result.rows[0]) : null
  }),

  create: protectedProcedure.input(z.object(createSkuInputShape)).mutation(async ({ input }) => {
    const client = await pool.connect()
    // Declared outside the try block so the catch's unique-violation
    // translation below can still reference it.
    let skuCode = ''
    try {
      await client.query('BEGIN')
      const { feature, module: mod, product, vertical } = await resolveFeatureHierarchy(client, input.featureId)
      skuCode = buildSkuCode(vertical.code, product.code, mod.code, feature.code, feature.extra?.status ?? 'new')
      const dupResult = await client.query('SELECT 1 FROM commercial_skus WHERE sku_code=$1', [skuCode])
      if (dupResult.rows.length) throw new TRPCError({ code: 'CONFLICT', message: `A SKU with code "${skuCode}" already exists.` })

      const editionId = input.editionId ?? await resolveStandardEditionId(client)
      for (const [field, key, label] of skuFkChecks) {
        if (field === 'featureId') continue // already resolved+validated above
        const value = field === 'editionId' ? editionId : (input as any)[field]
        await assertMasterExists(client, key, value, label)
      }

      const minimumAllowedPrice = input.minimumAllowedPrice ?? input.floorPrice
      const maximumDiscountPercent = Math.min(90, input.maximumDiscountPercent ?? 90)
      const countResult = await client.query('SELECT COUNT(*) FROM commercial_skus')
      const displayOrder = input.displayOrder ?? Number(countResult.rows[0].count)

      const insertResult = await client.query(
        `INSERT INTO commercial_skus (
           sku_code, name, category_id, feature_id, edition_id, uom_id, currency_id, tax_class_id, billing_type_id,
           active_from, active_till, lifecycle_status, is_sellable, display_order,
           base_software_cost, implementation_cost_per_mm, integration_cost, third_party_cost,
           hardware_cost, cloud_cost, support_cost, training_cost,
           internal_price, floor_price, partner_price, government_price, enterprise_price, corporate_price, list_price,
           minimum_allowed_price, maximum_discount_percent, selected_pricing_levels
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
         RETURNING *`,
        [
          skuCode, input.name, input.categoryId, input.featureId, editionId, input.uomId, input.currencyId,
          input.taxClassId, input.billingTypeId, input.activeFrom, input.activeTill,
          input.lifecycleStatus ?? 'draft', input.isSellable ?? true, displayOrder,
          input.baseSoftwareCost, input.implementationCostPerMM, input.integrationCost, input.thirdPartyCost,
          input.hardwareCost, input.cloudCost, input.supportCost, input.trainingCost,
          input.internalPrice, input.floorPrice, input.partnerPrice, input.governmentPrice,
          input.enterprisePrice, input.corporatePrice, input.listPrice,
          minimumAllowedPrice, maximumDiscountPercent, JSON.stringify(input.selectedPricingLevels ?? []),
        ],
      )
      const row = insertResult.rows[0]
      await writeAuditLog(client, {
        entityType: 'sku', entityId: row.id, field: 'skuCode', oldValue: '', newValue: row.sku_code,
        reason: '', action: 'create',
      })
      await client.query('COMMIT')
      return toSku(row)
    } catch (e) {
      await client.query('ROLLBACK')
      // Same race as commercial_masters' code check above: the dupResult
      // SELECT isn't atomic with this INSERT, so a concurrent create of the
      // same skuCode is still stopped by commercial_skus_sku_code_idx, just
      // as a raw 23505 without this translation.
      if (isUniqueViolation(e)) throw new TRPCError({ code: 'CONFLICT', message: `A SKU with code "${skuCode}" already exists.` })
      throw e
    } finally {
      client.release()
    }
  }),

  /** `changeReason` is required whenever `patch` touches `lifecycleStatus` or
   *  any cost/pricing field (spec §15/§6.6) — now that `commercial_audit_logs`
   *  exists (Phase 6), this also closes the audit-log deferral Phase 5 left
   *  open, writing one entry per touched sensitive field. */
  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), patch: z.object(skuPatchShape), changeReason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const currentResult = await client.query('SELECT * FROM commercial_skus WHERE id=$1 FOR UPDATE', [input.id])
        const currentRow = currentResult.rows[0]
        if (!currentRow) throw new TRPCError({ code: 'NOT_FOUND', message: `No such SKU: ${input.id}` })
        const current = toSku(currentRow) as Record<string, any>
        const patch = input.patch as Record<string, any>

        const touchedFields = SKU_SENSITIVE_FIELDS.filter((f) => patch[f] !== undefined && patch[f] !== current[f])
        if (touchedFields.length > 0 && !input.changeReason?.trim()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'changeReason is required when changing lifecycle status, cost, or pricing fields.' })
        }
        for (const field of touchedFields) {
          await writeAuditLog(client, {
            entityType: 'sku', entityId: input.id, field,
            oldValue: String(current[field]), newValue: String(patch[field]),
            reason: input.changeReason ?? '', action: field === 'lifecycleStatus' ? 'status_change' : 'update',
          })
        }

        for (const [field, key, label] of skuFkChecks) {
          if (patch[field] !== undefined) await assertMasterExists(client, key, patch[field], label)
        }

        const fields = Object.keys(patch)
        if (fields.length) {
          const values = fields.map((f) => (skuJsonColumns.has(f) ? JSON.stringify(patch[f]) : patch[f]))
          const setClauses = fields.map((f, i) => `${skuColumnFor[f]}=$${i + 1}`)
          values.push(input.id)
          await client.query(`UPDATE commercial_skus SET ${[...setClauses, 'updated_at=now()'].join(', ')} WHERE id=$${values.length}`, values)
        }
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
      const result = await pool.query('SELECT * FROM commercial_skus WHERE id=$1', [input.id])
      return toSku(result.rows[0])
    }),

  /** PCS-038: throws if any BOM item or BOQ line item still references this
   *  SKU (as parent/component, or as the line's sku_id) — the BOQ-line-item
   *  half now that `commercial_boq_line_items` exists (Phase 6), closing the
   *  deferral Phase 5 left open (same pattern as Phase 2's employees.delete
   *  leaving the follow_ups cleanup for Phase 7). */
  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const inUse = await pool.query(
      `SELECT 1 FROM commercial_bom_items WHERE parent_sku_id=$1 OR component_sku_id=$1
       UNION ALL SELECT 1 FROM commercial_boq_line_items WHERE sku_id=$1 LIMIT 1`,
      [input.id],
    )
    if (inUse.rows.length) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete this SKU — it is still referenced by a BOQ line item or BOM entry.' })
    }
    await pool.query('DELETE FROM commercial_skus WHERE id=$1', [input.id])
  }),
})

// --- Commercial BOM (spec §6.4/§14) ----------------------------------------

const commercialBomRouter = router({
  listForSku: publicProcedure.input(z.object({ parentSkuId: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query('SELECT * FROM commercial_bom_items WHERE parent_sku_id=$1', [input.parentSkuId])
    return result.rows.map(toBomItem)
  }),

  listAll: publicProcedure.query(async () => {
    const result = await pool.query('SELECT * FROM commercial_bom_items')
    return result.rows.map(toBomItem)
  }),

  create: protectedProcedure
    .input(z.object({
      parentSkuId: z.string().uuid(), componentSkuId: z.string().uuid(),
      mandatory: z.boolean(), quantity: z.number(), notes: z.string(),
    }))
    .mutation(async ({ input }) => {
      if (input.parentSkuId === input.componentSkuId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'A SKU cannot be a BOM component of itself.' })
      }
      const parentExists = await pool.query('SELECT 1 FROM commercial_skus WHERE id=$1', [input.parentSkuId])
      if (!parentExists.rows.length) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such parent SKU: ${input.parentSkuId}` })
      const componentExists = await pool.query('SELECT 1 FROM commercial_skus WHERE id=$1', [input.componentSkuId])
      if (!componentExists.rows.length) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such component SKU: ${input.componentSkuId}` })

      const result = await pool.query(
        `INSERT INTO commercial_bom_items (parent_sku_id, component_sku_id, mandatory, quantity, notes)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [input.parentSkuId, input.componentSkuId, input.mandatory, input.quantity, input.notes],
      )
      return toBomItem(result.rows[0])
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      patch: z.object({
        parentSkuId: z.string().uuid().optional(), componentSkuId: z.string().uuid().optional(),
        mandatory: z.boolean().optional(), quantity: z.number().optional(), notes: z.string().optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      const currentResult = await pool.query('SELECT * FROM commercial_bom_items WHERE id=$1', [input.id])
      if (!currentResult.rows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: `No such BOM item: ${input.id}` })

      const fields = Object.keys(input.patch)
      if (!fields.length) return toBomItem(currentResult.rows[0])

      if (input.patch.parentSkuId !== undefined) {
        const exists = await pool.query('SELECT 1 FROM commercial_skus WHERE id=$1', [input.patch.parentSkuId])
        if (!exists.rows.length) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such parent SKU: ${input.patch.parentSkuId}` })
      }
      if (input.patch.componentSkuId !== undefined) {
        const exists = await pool.query('SELECT 1 FROM commercial_skus WHERE id=$1', [input.patch.componentSkuId])
        if (!exists.rows.length) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such component SKU: ${input.patch.componentSkuId}` })
      }

      const columnFor: Record<string, string> = {
        parentSkuId: 'parent_sku_id', componentSkuId: 'component_sku_id',
        mandatory: 'mandatory', quantity: 'quantity', notes: 'notes',
      }
      const values = fields.map((f) => (input.patch as any)[f])
      const setClauses = fields.map((f, i) => `${columnFor[f]}=$${i + 1}`)
      values.push(input.id)
      const result = await pool.query(
        `UPDATE commercial_bom_items SET ${setClauses.join(', ')} WHERE id=$${values.length} RETURNING *`,
        values,
      )
      return toBomItem(result.rows[0])
    }),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    await pool.query('DELETE FROM commercial_bom_items WHERE id=$1', [input.id])
  }),
})

// --- Commercial BOQ + line items (spec §6.5/§9/§10/§12/§13) ----------------

const boqStatusSchema = z.enum(['draft', 'submitted', 'under_review', 'approved', 'rejected', 'cancelled', 'archived'])
const linePricingLevelSchema = z.object({ level: pricingLevelKeySchema, sellingPrice: z.number().nullable() })

function toBoq(row: any) {
  return {
    id: row.id, boqNumber: row.boq_number, opportunityName: row.opportunity_name, departmentId: row.department_id,
    customerName: row.customer_name, customerOrganization: row.customer_organization,
    customerAddress: row.customer_address, customerContact: row.customer_contact, verticalId: row.vertical_id,
    budgetAmount: row.budget_amount, budgetUnit: row.budget_unit, budgetKnown: row.budget_known,
    emdAmount: row.emd_amount, emdUnit: row.emd_unit,
    salesPersonId: row.sales_person_id, buSalesPersonId: row.bu_sales_person_id, preSalesId: row.pre_sales_id,
    status: row.status, boqVersion: row.boq_version, revisionNumber: row.revision_number, parentBoqId: row.parent_boq_id,
    currency: row.currency, grandTotal: Number(row.grand_total),
    createdAt: row.created_at.toISOString(), createdBy: row.created_by,
    lastModifiedAt: row.updated_at.toISOString(), lastModifiedBy: row.last_modified_by,
  }
}

function toLineItem(row: any) {
  return {
    id: row.id, boqId: row.boq_id, skuId: row.sku_id,
    quantity: Number(row.quantity), unitPrice: Number(row.unit_price), discountPct: Number(row.discount_pct),
    taxPct: Number(row.tax_pct), approverId: row.approver_id, approvalDate: row.approval_date,
    approvalRemarks: row.approval_remarks, approvalStatus: row.approval_status, lineTotal: Number(row.line_total),
    pricingLevels: row.pricing_levels, activePricingLevel: row.active_pricing_level,
  }
}

async function currencyRateByCode(client: any, code: string): Promise<number> {
  const result = await client.query(
    `SELECT (extra->>'exchangeRate')::numeric AS rate FROM commercial_masters WHERE master_key='currencies' AND code=$1`, [code],
  )
  if (!result.rows[0]) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such currency code: ${code}` })
  return Number(result.rows[0].rate)
}

async function currencyRateById(client: any, id: string): Promise<number> {
  const result = await client.query(
    `SELECT (extra->>'exchangeRate')::numeric AS rate FROM commercial_masters WHERE master_key='currencies' AND id=$1`, [id],
  )
  if (!result.rows[0]) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such currency: ${id}` })
  return Number(result.rows[0].rate)
}

/** Mirrors the frontend's `skuToBoqConversionFactor` — a SKU's cost/price
 *  fields are in that SKU's own currency; `commercial_boqs.currency` is a
 *  single code the whole document is denominated in. */
async function skuToBoqConversionFactor(client: any, boqCurrencyCode: string, sku: any): Promise<number> {
  const fromRate = await currencyRateById(client, sku.currency_id)
  const toRate = await currencyRateByCode(client, boqCurrencyCode)
  return conversionFactorFromRates(fromRate, toRate)
}

async function fetchApprovalMatrix(client: any): Promise<{ minDiscountPct: number; maxDiscountPct: number; allowAutoApproval: boolean }[]> {
  const result = await client.query(`SELECT extra FROM commercial_masters WHERE master_key='approvalMatrix'`)
  return result.rows.map((r: any) => ({
    minDiscountPct: Number(r.extra.minDiscountPct), maxDiscountPct: Number(r.extra.maxDiscountPct),
    allowAutoApproval: Boolean(r.extra.allowAutoApproval),
  }))
}

/** Mirrors the frontend's `resolveLineUnitPrice` — a small per-item lookup
 *  (not a full-array traversal), so only the shared arithmetic
 *  (`discountPctForSellingPrice`) moved to `@goms/domain`; this lookup itself
 *  stays local, same as every prior phase's traversal/algorithm split. */
function resolveLineUnitPrice(sku: any, currentDiscountPct: number, pricingLevels: any[], activePricingLevel: string | null) {
  const active = activePricingLevel ? pricingLevels.find((l: any) => l.level === activePricingLevel) : undefined
  if (!active || active.sellingPrice === null) {
    return { unitPrice: Number(sku.list_price), discountPct: currentDiscountPct, isAbsolutePrice: false }
  }
  return {
    unitPrice: active.sellingPrice,
    discountPct: discountPctForSellingPrice(Number(sku.list_price), active.sellingPrice),
    isAbsolutePrice: true,
  }
}

/** A BOQ line's `unit_price`/`tax_pct`/`line_total` are snapshots taken when
 *  the line was added — once the BOQ leaves `draft`, that snapshot IS the
 *  quoted price. While still `draft`, every read instead recomputes live off
 *  each line's SKU's *current* price/tax/currency, mirroring the frontend's
 *  `withLiveDraftPricing` exactly (including: never writes the recompute
 *  back to the row, only to the returned value). */
async function withLiveDraftPricing(client: any, boq: any, lines: any[]): Promise<any[]> {
  if (boq.status !== 'draft' || !lines.length) return lines
  const skuIds = [...new Set(lines.map((l: any) => l.sku_id))]
  const skuRows = (await client.query('SELECT * FROM commercial_skus WHERE id = ANY($1)', [skuIds])).rows
  const skusById = new Map<string, any>(skuRows.map((s: any) => [s.id, s]))

  const taxClassIds = [...new Set(skuRows.map((s: any) => s.tax_class_id))]
  const taxRows = taxClassIds.length
    ? (await client.query(`SELECT id, (extra->>'ratePct')::numeric AS rate_pct FROM commercial_masters WHERE id = ANY($1)`, [taxClassIds])).rows
    : []
  const taxPctById = new Map<string, number>(taxRows.map((t: any) => [t.id, Number(t.rate_pct)]))

  const currencyIds = [...new Set(skuRows.map((s: any) => s.currency_id))]
  const currencyRows = currencyIds.length
    ? (await client.query(
        `SELECT id, (extra->>'exchangeRate')::numeric AS rate FROM commercial_masters WHERE master_key='currencies' AND id = ANY($1)`,
        [currencyIds],
      )).rows
    : []
  const rateById = new Map<string, number>(currencyRows.map((c: any) => [c.id, Number(c.rate)]))
  const boqRate = await currencyRateByCode(client, boq.currency)

  return lines.map((line: any) => {
    const sku = skusById.get(line.sku_id)
    if (!sku) return line
    const taxPct = taxPctById.get(sku.tax_class_id) ?? 0
    const factor = conversionFactorFromRates(rateById.get(sku.currency_id) ?? 1, boqRate)
    const { unitPrice, discountPct, isAbsolutePrice } = resolveLineUnitPrice(sku, Number(line.discount_pct), line.pricing_levels, line.active_pricing_level)
    return {
      ...line, unit_price: unitPrice, discount_pct: discountPct, tax_pct: taxPct,
      line_total: computeLineTotal(Number(line.quantity), unitPrice, discountPct, taxPct, factor, isAbsolutePrice),
    }
  })
}

/** Recomputes a BOQ's `grand_total` from its line items' `line_total`s —
 *  mirrors the frontend's `recomputeBoqGrandTotal`, called after every
 *  add/update/remove of a line. */
async function recomputeBoqGrandTotal(client: any, boqId: string): Promise<void> {
  const result = await client.query('SELECT COALESCE(SUM(line_total), 0) AS total FROM commercial_boq_line_items WHERE boq_id=$1', [boqId])
  await client.query('UPDATE commercial_boqs SET grand_total=$1, updated_at=now() WHERE id=$2', [result.rows[0].total, boqId])
}

/** Mirrors the frontend's `withLiveDraftGrandTotal` — only recomputes (never
 *  persists) while the BOQ is still `draft`. `preFetchedLines`, when passed,
 *  skips this function's own per-BOQ line-items SELECT — used by `list`
 *  (below) to batch-fetch every draft BOQ's lines in one query instead of
 *  one query per BOQ (an N+1 that used to fire on every BOQ-list page load).
 *  `withLiveDraftPricing` still issues its own SKU/tax/currency lookups per
 *  BOQ — a smaller, separate N+1 left as-is here (see the 2026-08-26 backend
 *  hardening checkpoint for why: batching it would mean threading a
 *  cross-BOQ prefetch through `withLiveDraftPricing`'s per-BOQ signature, a
 *  larger refactor of shared pricing logic than this pass takes on). */
async function withLiveDraftGrandTotal(client: any, boq: any, preFetchedLines?: any[]): Promise<any> {
  if (boq.status !== 'draft') return boq
  const lines = preFetchedLines ?? (await client.query('SELECT * FROM commercial_boq_line_items WHERE boq_id=$1', [boq.id])).rows
  const liveLines = await withLiveDraftPricing(client, boq, lines)
  const grandTotal = liveLines.reduce((sum: number, li: any) => sum + Number(li.line_total), 0)
  return grandTotal === Number(boq.grand_total) ? boq : { ...boq, grand_total: grandTotal }
}

async function assertOpportunityNameAvailable(client: any, opportunityName: string, excludeId: string | null): Promise<void> {
  const trimmed = opportunityName.trim()
  if (!trimmed) return
  const result = excludeId
    ? await client.query(`SELECT boq_number FROM commercial_boqs WHERE id<>$1 AND lower(trim(opportunity_name))=lower($2)`, [excludeId, trimmed])
    : await client.query(`SELECT boq_number FROM commercial_boqs WHERE lower(trim(opportunity_name))=lower($1)`, [trimmed])
  if (result.rows[0]) {
    throw new TRPCError({ code: 'CONFLICT', message: `Opportunity Name "${trimmed}" is already used by ${result.rows[0].boq_number}.` })
  }
}

/** Allocates the next BOQ number for the current year — a single atomic
 *  `INSERT ... ON CONFLICT DO UPDATE` (row-level lock implicit in the
 *  upsert), matching the frontend's `generateBoqNumber`'s "never reset,
 *  never reused" counter semantics without a separate SELECT-then-UPDATE
 *  race window. */
async function allocateBoqNumber(client: any): Promise<string> {
  const year = new Date().getFullYear()
  const result = await client.query(
    `INSERT INTO commercial_boq_number_sequences (year, next_value) VALUES ($1, 2)
     ON CONFLICT (year) DO UPDATE SET next_value = commercial_boq_number_sequences.next_value + 1
     RETURNING next_value - 1 AS allocated`,
    [year],
  )
  return formatBoqNumber(year, result.rows[0].allocated)
}

const boqColumnFor: Record<string, string> = {
  opportunityName: 'opportunity_name', departmentId: 'department_id', customerName: 'customer_name',
  customerOrganization: 'customer_organization', customerAddress: 'customer_address', customerContact: 'customer_contact',
  verticalId: 'vertical_id', budgetAmount: 'budget_amount', budgetUnit: 'budget_unit', budgetKnown: 'budget_known',
  emdAmount: 'emd_amount', emdUnit: 'emd_unit', salesPersonId: 'sales_person_id',
  buSalesPersonId: 'bu_sales_person_id', preSalesId: 'pre_sales_id', currency: 'currency',
}

// opportunityName has no min-length here — the repository layer accepts a
// blank name (findBoqByOpportunityName treats blanks as never-clashing);
// "must be non-blank" is a CreateBoq.tsx save-readiness check, UI-only.
const boqInputShape = {
  opportunityName: z.string(), departmentId: z.string().uuid(),
  customerName: z.string(), customerOrganization: z.string(), customerAddress: z.string(), customerContact: z.string(),
  verticalId: z.string().uuid(),
  budgetAmount: z.string(), budgetUnit: z.string(), budgetKnown: z.string(), emdAmount: z.string(), emdUnit: z.string(),
  salesPersonId: z.string().uuid(), buSalesPersonId: z.string().uuid().nullable(), preSalesId: z.string().uuid().nullable(),
  currency: z.string().min(1),
}

const boqPatchShape = {
  opportunityName: z.string().optional(), departmentId: z.string().uuid().optional(),
  customerName: z.string().optional(), customerOrganization: z.string().optional(),
  customerAddress: z.string().optional(), customerContact: z.string().optional(),
  verticalId: z.string().uuid().optional(),
  budgetAmount: z.string().optional(), budgetUnit: z.string().optional(), budgetKnown: z.string().optional(),
  emdAmount: z.string().optional(), emdUnit: z.string().optional(),
  salesPersonId: z.string().uuid().optional(), buSalesPersonId: z.string().uuid().nullable().optional(),
  preSalesId: z.string().uuid().nullable().optional(), currency: z.string().min(1).optional(),
}

// isForeignKeyViolation/isUniqueViolation now live in ../db-errors.js —
// shared with hierarchy.ts and sales.ts, which have the identical
// unhandled-RESTRICT-violation gap this router originally solved alone.

const BOQ_LINE_ITEM_INSERT_COLUMNS =
  `boq_id, sku_id, quantity, unit_price, discount_pct, tax_pct, approver_id, approval_date, approval_remarks,
   approval_status, line_total, pricing_levels, active_pricing_level, sort_order`

async function copyLineItemsForRevisionOrDuplicate(client: any, fromBoqId: string, toBoqId: string): Promise<void> {
  const linesResult = await client.query('SELECT * FROM commercial_boq_line_items WHERE boq_id=$1 ORDER BY sort_order', [fromBoqId])
  const approvalMatrix = await fetchApprovalMatrix(client)
  for (const line of linesResult.rows) {
    const fresh = freshLineApprovalState(approvalMatrix, Number(line.discount_pct))
    await client.query(
      `INSERT INTO commercial_boq_line_items (${BOQ_LINE_ITEM_INSERT_COLUMNS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        toBoqId, line.sku_id, line.quantity, line.unit_price, line.discount_pct, line.tax_pct,
        fresh.approverId, fresh.approvalDate, fresh.approvalRemarks, fresh.approvalStatus,
        line.line_total, JSON.stringify(line.pricing_levels), line.active_pricing_level, line.sort_order,
      ],
    )
  }
}

const commercialBoqRouter = router({
  // Batches every draft BOQ's line items into one query instead of one
  // query per BOQ (previously: 1 + N round trips for N draft BOQs, on every
  // load of this list — see the function comment on withLiveDraftGrandTotal).
  list: protectedReadProcedure.query(async () => {
    const result = await pool.query('SELECT * FROM commercial_boqs ORDER BY created_at DESC')
    const draftIds = result.rows.filter((r: any) => r.status === 'draft').map((r: any) => r.id)
    const linesByBoqId = new Map<string, any[]>()
    if (draftIds.length) {
      const linesResult = await pool.query('SELECT * FROM commercial_boq_line_items WHERE boq_id = ANY($1)', [draftIds])
      for (const line of linesResult.rows) {
        const existing = linesByBoqId.get(line.boq_id)
        if (existing) existing.push(line)
        else linesByBoqId.set(line.boq_id, [line])
      }
    }
    const withTotals = await Promise.all(
      result.rows.map((r: any) => withLiveDraftGrandTotal(pool, r, linesByBoqId.get(r.id) ?? [])),
    )
    return withTotals.map(toBoq)
  }),

  get: protectedReadProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query('SELECT * FROM commercial_boqs WHERE id=$1', [input.id])
    if (!result.rows[0]) return null
    return toBoq(await withLiveDraftGrandTotal(pool, result.rows[0]))
  }),

  listLineItems: protectedReadProcedure.input(z.object({ boqId: z.string().uuid() })).query(async ({ input }) => {
    const boqResult = await pool.query('SELECT * FROM commercial_boqs WHERE id=$1', [input.boqId])
    const linesResult = await pool.query('SELECT * FROM commercial_boq_line_items WHERE boq_id=$1 ORDER BY sort_order', [input.boqId])
    const lines = boqResult.rows[0] ? await withLiveDraftPricing(pool, boqResult.rows[0], linesResult.rows) : linesResult.rows
    return lines.map(toLineItem)
  }),

  /** Every BOQ line item across every BOQ — read-only aggregate for the SKU
   *  Catalog's "BOQ Count" column. */
  listAllLineItems: protectedReadProcedure.query(async () => {
    const result = await pool.query('SELECT * FROM commercial_boq_line_items')
    return result.rows.map(toLineItem)
  }),

  create: protectedProcedure.input(z.object(boqInputShape)).mutation(async ({ input }) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await assertOpportunityNameAvailable(client, input.opportunityName, null)
      const boqNumber = await allocateBoqNumber(client)
      const insertResult = await client.query(
        `INSERT INTO commercial_boqs (
           boq_number, opportunity_name, department_id, customer_name, customer_organization, customer_address, customer_contact,
           vertical_id, budget_amount, budget_unit, budget_known, emd_amount, emd_unit,
           sales_person_id, bu_sales_person_id, pre_sales_id, currency
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [
          boqNumber, input.opportunityName, input.departmentId, input.customerName, input.customerOrganization,
          input.customerAddress, input.customerContact, input.verticalId, input.budgetAmount, input.budgetUnit,
          input.budgetKnown, input.emdAmount, input.emdUnit, input.salesPersonId, input.buSalesPersonId,
          input.preSalesId, input.currency,
        ],
      )
      const row = insertResult.rows[0]
      await writeAuditLog(client, {
        entityType: 'boq', entityId: row.id, field: 'boqNumber', oldValue: '', newValue: row.boq_number,
        reason: '', action: 'create',
      })
      await client.query('COMMIT')
      return toBoq(row)
    } catch (e) {
      await client.query('ROLLBACK')
      if (isForeignKeyViolation(e)) throw new TRPCError({ code: 'BAD_REQUEST', message: e.detail ?? 'A referenced row does not exist.' })
      throw e
    } finally {
      client.release()
    }
  }),

  /** BOQ-level metadata patch — throws unless `status === 'draft'` (BOQ
   *  editable-workspace overhaul spec §3). */
  update: protectedProcedure.input(z.object({ id: z.string().uuid(), patch: z.object(boqPatchShape) })).mutation(async ({ input }) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const currentResult = await client.query('SELECT * FROM commercial_boqs WHERE id=$1 FOR UPDATE', [input.id])
      const current = currentResult.rows[0]
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: `No such BOQ: ${input.id}` })
      if (current.status !== 'draft') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only a Draft BOQ can have its details edited.' })
      }
      const patch = input.patch as Record<string, any>
      if (patch.opportunityName !== undefined) await assertOpportunityNameAvailable(client, patch.opportunityName, input.id)

      const fields = Object.keys(patch)
      for (const field of fields) {
        const column = boqColumnFor[field]
        const oldValue = current[column]
        const newValue = patch[field]
        if (newValue !== oldValue) {
          await writeAuditLog(client, {
            entityType: 'boq', entityId: input.id, field,
            oldValue: oldValue === null ? '' : String(oldValue), newValue: newValue === null ? '' : String(newValue),
            reason: '', action: 'update',
          })
        }
      }
      if (fields.length) {
        const values = fields.map((f) => patch[f])
        const setClauses = fields.map((f, i) => `${boqColumnFor[f]}=$${i + 1}`)
        values.push(input.id)
        await client.query(`UPDATE commercial_boqs SET ${[...setClauses, 'updated_at=now()'].join(', ')} WHERE id=$${values.length}`, values)
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      if (isForeignKeyViolation(e)) throw new TRPCError({ code: 'BAD_REQUEST', message: e.detail ?? 'A referenced row does not exist.' })
      throw e
    } finally {
      client.release()
    }
    const result = await pool.query('SELECT * FROM commercial_boqs WHERE id=$1', [input.id])
    return toBoq(await withLiveDraftGrandTotal(pool, result.rows[0]))
  }),

  addLineItem: protectedProcedure
    .input(z.object({
      boqId: z.string().uuid(), skuId: z.string().uuid(), quantity: z.number(), unitPrice: z.number(), discountPct: z.number(),
      approverId: z.string().uuid().nullable().optional(), approvalRemarks: z.string().optional(),
      pricingLevels: z.array(linePricingLevelSchema).optional(), activePricingLevel: pricingLevelKeySchema.nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const boqResult = await client.query('SELECT * FROM commercial_boqs WHERE id=$1 FOR UPDATE', [input.boqId])
        const boq = boqResult.rows[0]
        if (!boq) throw new TRPCError({ code: 'NOT_FOUND', message: `No such BOQ: ${input.boqId}` })
        const skuResult = await client.query('SELECT * FROM commercial_skus WHERE id=$1', [input.skuId])
        const sku = skuResult.rows[0]
        if (!sku) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such SKU: ${input.skuId}` })

        validateLineQuantity(input.quantity)
        validateLineDiscountPct(input.discountPct, Math.min(90, Number(sku.maximum_discount_percent)))

        const pricingLevels = input.pricingLevels ?? []
        const activePricingLevel = input.activePricingLevel ?? null
        const isAbsolutePrice = isAbsoluteLinePrice(pricingLevels, activePricingLevel)
        const postDiscountPrice = effectiveUnitPrice(input.unitPrice, input.discountPct, isAbsolutePrice)
        if (postDiscountPrice < Number(sku.minimum_allowed_price)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Discounted unit price (${postDiscountPrice.toFixed(2)}) is below this SKU's minimum allowed price (${Number(sku.minimum_allowed_price)}).`,
          })
        }

        const taxRateResult = await client.query(`SELECT (extra->>'ratePct')::numeric AS rate FROM commercial_masters WHERE id=$1`, [sku.tax_class_id])
        const taxPct = Number(taxRateResult.rows[0]?.rate ?? 0)
        const approvalMatrix = await fetchApprovalMatrix(client)
        const band = resolveApprovalBand(approvalMatrix, input.discountPct)
        const factor = await skuToBoqConversionFactor(client, boq.currency, sku)
        const lineTotal = computeLineTotal(input.quantity, input.unitPrice, input.discountPct, taxPct, factor, isAbsolutePrice)
        const sortOrderResult = await client.query('SELECT COUNT(*)::int AS n FROM commercial_boq_line_items WHERE boq_id=$1', [input.boqId])

        const insertResult = await client.query(
          `INSERT INTO commercial_boq_line_items (${BOQ_LINE_ITEM_INSERT_COLUMNS})
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING *`,
          [
            input.boqId, input.skuId, input.quantity, input.unitPrice, input.discountPct, taxPct,
            input.approverId ?? null, null, input.approvalRemarks ?? '', band.allowAutoApproval ? 'auto_approved' : 'pending',
            lineTotal, JSON.stringify(pricingLevels), activePricingLevel, sortOrderResult.rows[0].n,
          ],
        )
        await recomputeBoqGrandTotal(client, input.boqId)
        await client.query('COMMIT')
        return toLineItem(insertResult.rows[0])
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  updateLineItem: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      patch: z.object({
        quantity: z.number().optional(), unitPrice: z.number().optional(), discountPct: z.number().optional(),
        approverId: z.string().uuid().nullable().optional(), approvalDate: z.string().nullable().optional(),
        approvalRemarks: z.string().optional(), approvalStatus: z.enum(['auto_approved', 'pending', 'approved', 'rejected']).optional(),
        pricingLevels: z.array(linePricingLevelSchema).optional(), activePricingLevel: pricingLevelKeySchema.nullable().optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const rowResult = await client.query('SELECT * FROM commercial_boq_line_items WHERE id=$1 FOR UPDATE', [input.id])
        const row = rowResult.rows[0]
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: `No such BOQ line item: ${input.id}` })
        const skuResult = await client.query('SELECT * FROM commercial_skus WHERE id=$1', [row.sku_id])
        const sku = skuResult.rows[0]
        if (!sku) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such SKU: ${row.sku_id}` })
        // FOR UPDATE: recomputeBoqGrandTotal below reads this BOQ's line
        // items' SUM() then writes grand_total — without holding this row's
        // lock for the rest of the transaction, a concurrent updateLineItem/
        // removeLineItem on a sibling line of the same BOQ can compute its
        // own SUM() before this transaction's UPDATE is visible to it (and
        // vice versa), and whichever commits last overwrites the other's
        // already-committed change out of the aggregate — a lost update.
        const boqResult = await client.query('SELECT * FROM commercial_boqs WHERE id=$1 FOR UPDATE', [row.boq_id])
        const boq = boqResult.rows[0]
        if (!boq) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such BOQ: ${row.boq_id}` })

        const patch = input.patch
        if (patch.quantity !== undefined) validateLineQuantity(patch.quantity)
        const quantity = patch.quantity !== undefined ? patch.quantity : Number(row.quantity)
        const unitPrice = patch.unitPrice ?? Number(row.unit_price)
        if (patch.discountPct !== undefined) validateLineDiscountPct(patch.discountPct, Math.min(90, Number(sku.maximum_discount_percent)))
        const discountPct = patch.discountPct !== undefined ? patch.discountPct : Number(row.discount_pct)
        const pricingLevels = patch.pricingLevels ?? row.pricing_levels
        const activePricingLevel = patch.activePricingLevel !== undefined ? patch.activePricingLevel : row.active_pricing_level
        const isAbsolutePrice = isAbsoluteLinePrice(pricingLevels, activePricingLevel)

        const postDiscountPrice = effectiveUnitPrice(unitPrice, discountPct, isAbsolutePrice)
        if (postDiscountPrice < Number(sku.minimum_allowed_price)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Discounted unit price (${postDiscountPrice.toFixed(2)}) is below this SKU's minimum allowed price (${Number(sku.minimum_allowed_price)}).`,
          })
        }

        const oldQuantity = Number(row.quantity)
        const oldDiscountPct = Number(row.discount_pct)

        let approvalStatus = patch.approvalStatus ?? row.approval_status
        let approverId = patch.approverId !== undefined ? patch.approverId : row.approver_id
        let approvalDate = patch.approvalDate !== undefined ? patch.approvalDate : row.approval_date
        let approvalRemarks = patch.approvalRemarks !== undefined ? patch.approvalRemarks : row.approval_remarks

        // A changed discount invalidates whatever approval decision (or lack
        // of one) the line had — mirrors the frontend's identical reset.
        if (patch.discountPct !== undefined) {
          const approvalMatrix = await fetchApprovalMatrix(client)
          const fresh = freshLineApprovalState(approvalMatrix, discountPct)
          approvalStatus = fresh.approvalStatus
          approverId = fresh.approverId
          approvalDate = fresh.approvalDate
          approvalRemarks = fresh.approvalRemarks
        }

        const factor = await skuToBoqConversionFactor(client, boq.currency, sku)
        const lineTotal = computeLineTotal(quantity, unitPrice, discountPct, Number(row.tax_pct), factor, isAbsolutePrice)

        await client.query(
          `UPDATE commercial_boq_line_items SET
             quantity=$1, unit_price=$2, discount_pct=$3, approver_id=$4, approval_date=$5, approval_remarks=$6,
             approval_status=$7, pricing_levels=$8, active_pricing_level=$9, line_total=$10
           WHERE id=$11`,
          [quantity, unitPrice, discountPct, approverId, approvalDate, approvalRemarks,
            approvalStatus, JSON.stringify(pricingLevels), activePricingLevel, lineTotal, input.id],
        )
        await recomputeBoqGrandTotal(client, row.boq_id)

        if (patch.quantity !== undefined && quantity !== oldQuantity) {
          await writeAuditLog(client, {
            entityType: 'boqLineItem', entityId: input.id, field: 'quantity',
            oldValue: String(oldQuantity), newValue: String(quantity), reason: '', action: 'update',
          })
        }
        if (patch.discountPct !== undefined && discountPct !== oldDiscountPct) {
          await writeAuditLog(client, {
            entityType: 'boqLineItem', entityId: input.id, field: 'discountPct',
            oldValue: String(oldDiscountPct), newValue: String(discountPct), reason: '', action: 'update',
          })
        }
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
      const result = await pool.query('SELECT * FROM commercial_boq_line_items WHERE id=$1', [input.id])
      return toLineItem(result.rows[0])
    }),

  removeLineItem: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const existing = await client.query('SELECT boq_id FROM commercial_boq_line_items WHERE id=$1', [input.id])
      if (!existing.rows[0]) {
        await client.query('COMMIT')
        return
      }
      // Same FOR UPDATE reasoning as updateLineItem above — locks the BOQ
      // row for the rest of this transaction so the SUM()-then-UPDATE in
      // recomputeBoqGrandTotal can't lose a concurrent sibling-line change.
      await client.query('SELECT id FROM commercial_boqs WHERE id=$1 FOR UPDATE', [existing.rows[0].boq_id])
      await client.query('DELETE FROM commercial_boq_line_items WHERE id=$1', [input.id])
      await recomputeBoqGrandTotal(client, existing.rows[0].boq_id)
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }),

  /** Reorders a draft BOQ's line items — `orderedIds` must be exactly this
   *  BOQ's current line item ids, each exactly once, in the desired order.
   *  Throws unless `status === 'draft'` (BOQ workbench spec §6). */
  reorderLineItems: protectedProcedure
    .input(z.object({ boqId: z.string().uuid(), orderedIds: z.array(z.string().uuid()) }))
    .mutation(async ({ input }) => {
      const boqResult = await pool.query('SELECT status FROM commercial_boqs WHERE id=$1', [input.boqId])
      const boq = boqResult.rows[0]
      if (!boq) throw new TRPCError({ code: 'NOT_FOUND', message: `No such BOQ: ${input.boqId}` })
      if (boq.status !== 'draft') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only a Draft BOQ can have its line items reordered.' })
      const ownResult = await pool.query('SELECT id FROM commercial_boq_line_items WHERE boq_id=$1', [input.boqId])
      const ownIds = new Set(ownResult.rows.map((r: any) => r.id))
      if (input.orderedIds.length !== ownIds.size || !input.orderedIds.every((id) => ownIds.has(id))) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "orderedIds must contain exactly this BOQ's current line item ids, each exactly once." })
      }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        for (let i = 0; i < input.orderedIds.length; i++) {
          await client.query('UPDATE commercial_boq_line_items SET sort_order=$1 WHERE id=$2', [i, input.orderedIds[i]])
        }
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  /** Throws on an invalid lifecycle transition (spec §10's `BOQ_TRANSITIONS`);
   *  blocks a transition to `approved` while any line item's approval status
   *  isn't cleared (PCS-029). */
  updateStatus: protectedProcedure
    .input(z.object({ id: z.string().uuid(), nextStatus: boqStatusSchema, changeReason: z.string() }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const boqResult = await client.query('SELECT * FROM commercial_boqs WHERE id=$1 FOR UPDATE', [input.id])
        const boq = boqResult.rows[0]
        if (!boq) throw new TRPCError({ code: 'NOT_FOUND', message: `No such BOQ: ${input.id}` })
        const allowed = BOQ_TRANSITIONS[boq.status as BoqStatus]
        if (!allowed.includes(input.nextStatus)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot transition a BOQ from "${boq.status}" to "${input.nextStatus}".` })
        }
        if (input.nextStatus === 'approved') {
          const unresolvedResult = await client.query(
            'SELECT COUNT(*)::int AS n FROM commercial_boq_line_items WHERE boq_id=$1 AND approval_status <> ALL($2)',
            [input.id, LINE_STATES_CLEARED_FOR_APPROVAL],
          )
          const unresolvedCount = unresolvedResult.rows[0].n
          if (unresolvedCount > 0) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Cannot approve this BOQ — ${unresolvedCount} line item(s) do not have an approved discount status.`,
            })
          }
        }
        await client.query('UPDATE commercial_boqs SET status=$1, updated_at=now() WHERE id=$2', [input.nextStatus, input.id])
        await writeAuditLog(client, {
          entityType: 'boq', entityId: input.id, field: 'status', oldValue: boq.status, newValue: input.nextStatus,
          reason: input.changeReason, action: 'status_change',
        })
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
      const result = await pool.query('SELECT * FROM commercial_boqs WHERE id=$1', [input.id])
      return toBoq(result.rows[0])
    }),

  /** Creates a new BOQ row carrying the same `boqNumber` forward, with
   *  `boqVersion` incremented and its line items copied (spec §9/§13). */
  revise: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const originalResult = await client.query('SELECT * FROM commercial_boqs WHERE id=$1', [input.id])
      const original = originalResult.rows[0]
      if (!original) throw new TRPCError({ code: 'NOT_FOUND', message: `No such BOQ: ${input.id}` })

      const insertResult = await client.query(
        `INSERT INTO commercial_boqs (
           boq_number, opportunity_name, department_id, customer_name, customer_organization, customer_address, customer_contact,
           vertical_id, budget_amount, budget_unit, budget_known, emd_amount, emd_unit,
           sales_person_id, bu_sales_person_id, pre_sales_id, status, boq_version, revision_number, parent_boq_id, currency, grand_total
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'draft',$17,0,$18,$19,$20)
         RETURNING *`,
        [
          original.boq_number, original.opportunity_name, original.department_id, original.customer_name, original.customer_organization,
          original.customer_address, original.customer_contact, original.vertical_id, original.budget_amount, original.budget_unit,
          original.budget_known, original.emd_amount, original.emd_unit, original.sales_person_id, original.bu_sales_person_id,
          original.pre_sales_id, original.boq_version + 1, original.id, original.currency, original.grand_total,
        ],
      )
      const revised = insertResult.rows[0]
      await copyLineItemsForRevisionOrDuplicate(client, original.id, revised.id)
      await writeAuditLog(client, {
        entityType: 'boq', entityId: revised.id, field: 'boqVersion',
        oldValue: String(original.boq_version), newValue: String(revised.boq_version),
        reason: 'Revision of an existing BOQ.', action: 'create',
      })
      await client.query('COMMIT')
      return toBoq(revised)
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }),

  /** Creates an independent new BOQ — fresh `boqNumber`, `status: 'draft'`,
   *  `boqVersion: 1`, no `parentBoqId` — copying this BOQ's fields and line
   *  items as a starting point. Distinct from `revise`, which keeps the same
   *  `boqNumber` and links back via `parentBoqId`. */
  duplicate: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const originalResult = await client.query('SELECT * FROM commercial_boqs WHERE id=$1', [input.id])
      const original = originalResult.rows[0]
      if (!original) throw new TRPCError({ code: 'NOT_FOUND', message: `No such BOQ: ${input.id}` })

      const boqNumber = await allocateBoqNumber(client)
      const insertResult = await client.query(
        `INSERT INTO commercial_boqs (
           boq_number, opportunity_name, department_id, customer_name, customer_organization, customer_address, customer_contact,
           vertical_id, budget_amount, budget_unit, budget_known, emd_amount, emd_unit,
           sales_person_id, bu_sales_person_id, pre_sales_id, status, boq_version, revision_number, parent_boq_id, currency, grand_total
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'draft',1,0,NULL,$17,$18)
         RETURNING *`,
        [
          boqNumber, original.opportunity_name, original.department_id, original.customer_name, original.customer_organization,
          original.customer_address, original.customer_contact, original.vertical_id, original.budget_amount, original.budget_unit,
          original.budget_known, original.emd_amount, original.emd_unit, original.sales_person_id, original.bu_sales_person_id,
          original.pre_sales_id, original.currency, original.grand_total,
        ],
      )
      const duplicate = insertResult.rows[0]
      await copyLineItemsForRevisionOrDuplicate(client, original.id, duplicate.id)
      await writeAuditLog(client, {
        entityType: 'boq', entityId: duplicate.id, field: 'boqNumber', oldValue: '', newValue: duplicate.boq_number,
        reason: `Duplicated from ${original.boq_number}.`, action: 'create',
      })
      await client.query('COMMIT')
      return toBoq(duplicate)
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }),

  /** Hard-deletes a BOQ and its line items (cascade via FK). Throws unless
   *  the BOQ is `draft`/`cancelled`/`rejected`/`archived` — anything still
   *  active in the pipeline must be cancelled first via `updateStatus`.
   *
   *  The status check and the DELETE run inside one transaction with the
   *  row locked FOR UPDATE — without this, a concurrent `updateStatus` call
   *  moving the BOQ out of a deletable status (e.g. draft -> submitted)
   *  between this mutation's own status read and its unconditional DELETE
   *  could silently destroy a BOQ that had, by the time the DELETE ran, just
   *  left the deletable set. Locking the row here also means a concurrent
   *  `updateStatus` (which itself takes FOR UPDATE, see below) simply waits
   *  its turn rather than racing. */
  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query('SELECT status FROM commercial_boqs WHERE id=$1 FOR UPDATE', [input.id])
      const boq = result.rows[0]
      if (!boq) throw new TRPCError({ code: 'NOT_FOUND', message: `No such BOQ: ${input.id}` })
      if (!DELETABLE_BOQ_STATUSES.includes(boq.status)) {
        throw new TRPCError({ code: 'CONFLICT', message: `Cannot delete a BOQ in "${boq.status}" status — cancel it first.` })
      }
      await client.query('DELETE FROM commercial_boqs WHERE id=$1', [input.id])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }),
})

const commercialAuditLogsRouter = router({
  // Protected (2026-09-15 follow-up to the read-protection rollout):
  // writeAuditLog is the shared sink for SKU cost/price-field changes and
  // BOQ customer/pricing-field changes alike (see its call sites above) —
  // leaving this endpoint public would re-expose the exact data
  // `commercial.skus`/`commercial.boq` were just protected for, just via
  // plaintext oldValue/newValue history instead of the live row.
  list: protectedReadProcedure
    .input(z.object({ entityType: z.string().optional(), entityId: z.string().optional() }).optional())
    .query(({ input }) => listAuditLogs(input)),
})

export const commercialRouter = router({
  masters: commercialMastersRouter,
  skus: commercialSkusRouter,
  bom: commercialBomRouter,
  boq: commercialBoqRouter,
  auditLogs: commercialAuditLogsRouter,
})
