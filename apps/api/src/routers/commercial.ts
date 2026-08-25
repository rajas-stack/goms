import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { publicProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import {
  buildSkuCode, MASTER_CHILD_OF, MASTER_EXTRA_FIELDS, MASTER_PARENT_FIELD, findMasterCodeClash,
  SKU_SENSITIVE_FIELDS, type CommercialMasterKey,
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

  create: publicProcedure
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
        throw e
      } finally {
        client.release()
      }
    }),

  update: publicProcedure
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
        // frontend's updateMasterLogic); persisting it to an audit log is
        // deferred until the phase that introduces commercial_audit_logs.
        if (key === 'features' && patch.status !== undefined && patch.status !== current.status) {
          if (!changeReason?.trim()) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: "changeReason is required when changing a feature's status." })
          }
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
        throw e
      } finally {
        client.release()
      }
    }),

  setActive: publicProcedure
    .input(z.object({ key: masterKeySchema, id: z.string().uuid(), active: z.boolean() }))
    .mutation(({ input }) =>
      pool.query('UPDATE commercial_masters SET active=$1, updated_at=now() WHERE master_key=$2 AND id=$3', [input.active, input.key, input.id])
        .then(() => undefined),
    ),

  delete: publicProcedure
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
      await pool.query('DELETE FROM commercial_masters WHERE master_key=$1 AND id=$2', [input.key, input.id])
    }),

  listEditionFeatures: publicProcedure
    .input(z.object({ editionId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await pool.query('SELECT * FROM edition_features WHERE edition_id=$1 ORDER BY display_order', [input.editionId])
      return result.rows.map(toEditionFeature)
    }),

  setEditionFeatures: publicProcedure
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

const commercialSkusRouter = router({
  list: publicProcedure.query(async () => {
    const result = await pool.query('SELECT * FROM commercial_skus ORDER BY display_order')
    return result.rows.map(toSku)
  }),

  get: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query('SELECT * FROM commercial_skus WHERE id=$1', [input.id])
    return result.rows[0] ? toSku(result.rows[0]) : null
  }),

  create: publicProcedure.input(z.object(createSkuInputShape)).mutation(async ({ input }) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { feature, module: mod, product, vertical } = await resolveFeatureHierarchy(client, input.featureId)
      const skuCode = buildSkuCode(vertical.code, product.code, mod.code, feature.code, feature.extra?.status ?? 'new')
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
      await client.query('COMMIT')
      return toSku(insertResult.rows[0])
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }),

  /** `changeReason` is required whenever `patch` touches `lifecycleStatus` or
   *  any cost/pricing field (spec §15/§6.6) — persisting the change to an
   *  audit log is deferred until `commercial_audit_logs` exists (Phase 6),
   *  matching Phase 4's identical deferral for `features.status` changes. */
  update: publicProcedure
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

  /** PCS-038: throws if any BOM item still references this SKU (as parent or
   *  component). The BOQ-line-item half of this check is deferred until
   *  `commercial_boq_line_items` exists (Phase 6) — same deferral pattern as
   *  Phase 2's employees.delete leaving the follow_ups cleanup for Phase 7. */
  delete: publicProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    const inUse = await pool.query(
      'SELECT 1 FROM commercial_bom_items WHERE parent_sku_id=$1 OR component_sku_id=$1 LIMIT 1',
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

  create: publicProcedure
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

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      patch: z.object({ mandatory: z.boolean().optional(), quantity: z.number().optional(), notes: z.string().optional() }),
    }))
    .mutation(async ({ input }) => {
      const currentResult = await pool.query('SELECT * FROM commercial_bom_items WHERE id=$1', [input.id])
      if (!currentResult.rows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: `No such BOM item: ${input.id}` })

      const fields = Object.keys(input.patch)
      if (!fields.length) return toBomItem(currentResult.rows[0])

      const columnFor: Record<string, string> = { mandatory: 'mandatory', quantity: 'quantity', notes: 'notes' }
      const values = fields.map((f) => (input.patch as any)[f])
      const setClauses = fields.map((f, i) => `${columnFor[f]}=$${i + 1}`)
      values.push(input.id)
      const result = await pool.query(
        `UPDATE commercial_bom_items SET ${setClauses.join(', ')} WHERE id=$${values.length} RETURNING *`,
        values,
      )
      return toBomItem(result.rows[0])
    }),

  delete: publicProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    await pool.query('DELETE FROM commercial_bom_items WHERE id=$1', [input.id])
  }),
})

export const commercialRouter = router({
  masters: commercialMastersRouter,
  skus: commercialSkusRouter,
  bom: commercialBomRouter,
})
