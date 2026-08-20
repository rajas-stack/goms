// Commercial Calculator module types.
// See docs/superpowers/specs/2026-08-03-commercial-calculator-design.md §6.
// This file is the ONLY place these types are defined — nothing is appended
// to src/lib/types.ts (spec §4.1's module-folder convention).

export interface MasterBase {
  id: string
  code: string
  name: string
  description: string
  active: boolean
  displayOrder: number
}

export interface Vertical extends MasterBase {}
export interface CommercialProduct extends MasterBase { verticalId: string }
export interface ProductModule extends MasterBase { productId: string }

export type FeatureStatus = 'existing' | 'modified' | 'new'
export interface ProductFeature extends MasterBase { moduleId: string; status: FeatureStatus }

export interface SkuCategory extends MasterBase {}
export interface UnitOfMeasure extends MasterBase {}
export interface ProductEdition extends MasterBase {}
export interface BillingType extends MasterBase {}
export interface TaxClass extends MasterBase { ratePct: number }

export interface ApprovalMatrixRule extends MasterBase {
  minDiscountPct: number
  maxDiscountPct: number
  approvalLevelLabel: string
  allowAutoApproval: boolean
}

export interface Currency extends MasterBase {
  symbol: string
  decimalPlaces: number
  /** Relative to whichever currency has `isBaseCurrency: true`. */
  exchangeRate: number
  isBaseCurrency: boolean
}

export interface PreSales extends MasterBase {}

/** Not a top-level nav item — edited from inside a Product Edition's detail
 *  view. Spec §6.2. */
export interface ProductEditionFeature {
  id: string
  editionId: string
  featureId: string
  mandatory: boolean
  displayOrder: number
}

/** The 12 Commercial Calculator master tables. "BU Sales" is intentionally
 *  absent — it's sourced from Account Mapping's existing `salesPersons`,
 *  not a master (spec §6.1.1). Never widen this without adding a matching
 *  key to `MasterRowMap` below — every consumer switches over this union. */
export type MasterEntityKey =
  | 'verticals' | 'products' | 'modules' | 'features'
  | 'skuCategories' | 'unitsOfMeasure' | 'productEditions' | 'billingTypes'
  | 'taxClasses' | 'approvalMatrix' | 'currencies' | 'preSales'

export interface MasterRowMap {
  verticals: Vertical
  products: CommercialProduct
  modules: ProductModule
  features: ProductFeature
  skuCategories: SkuCategory
  unitsOfMeasure: UnitOfMeasure
  productEditions: ProductEdition
  billingTypes: BillingType
  taxClasses: TaxClass
  approvalMatrix: ApprovalMatrixRule
  currencies: Currency
  preSales: PreSales
}

export type MastersState = { [K in MasterEntityKey]: MasterRowMap[K][] }

/** Every field except `id` (generated) is required; `active`/`displayOrder`
 *  default when omitted (`true` / append-to-end respectively). */
export type CreateMasterInput<K extends MasterEntityKey> = Omit<MasterRowMap[K], 'id' | 'active' | 'displayOrder'> & {
  active?: boolean
  displayOrder?: number
}

// --- SKU Catalog / Commercial Master (spec §6.3) --------------------------

export interface CommercialSku {
  id: string
  skuCode: string // generated, immutable, unique — spec §7
  name: string
  categoryId: string // → SkuCategory
  featureId: string // → ProductFeature
  editionId: string // → ProductEdition, required, defaults to the 'STD' edition
  uomId: string
  currencyId: string
  taxClassId: string
  billingTypeId: string
  activeFrom: string
  activeTill: string | null
  lifecycleStatus: 'draft' | 'active' | 'inactive' | 'retired'
  isSellable: boolean
  displayOrder: number

  // Cost Management — PCS-020..025
  baseSoftwareCost: number
  implementationCostPerMM: number
  integrationCost: number
  thirdPartyCost: number
  hardwareCost: number
  cloudCost: number
  supportCost: number
  trainingCost: number

  // Pricing Levels — PCS-026/027, all in this SKU's currency
  internalPrice: number
  floorPrice: number
  partnerPrice: number
  governmentPrice: number
  enterprisePrice: number
  corporatePrice: number
  listPrice: number

  minimumAllowedPrice: number
  /** Fallback ceiling used only when a line has no active pricing level
   *  (or a level with no per-level override — see `SkuPricingLevelSetting`
   *  below) — never a shared/global cap once a level defines its own. */
  maximumDiscountPercent: number

  /** Levels an admin has explicitly enabled for this SKU via "Set Pricing
   *  Levels" — empty by default; never all six shown unconditionally. Each
   *  entry's `maximumDiscountPercent` is independent of every other
   *  entry's — there is no field shared between, say, Internal and
   *  Government (2026-08-20 pricing-overhaul UI correction). */
  selectedPricingLevels: SkuPricingLevelSetting[]

  createdAt: string
  createdBy: string | null
}

// --- BOQ line-item pricing levels — 2026-08-19 pricing overhaul spec §2 ---

export type PricingLevelKey = 'internal' | 'floor' | 'partner' | 'government' | 'enterprise' | 'corporate'

/** `sellingPrice: null` means the user has added this level but not yet
 *  typed a price — never coerced to/displayed as 0 (spec §3). Discount % is
 *  deliberately NOT stored here; it's always derived against `listPrice`. */
export interface LinePricingLevel {
  level: PricingLevelKey
  sellingPrice: number | null
}

/** A pricing level an admin has enabled for a given SKU (2026-08-20
 *  pricing-overhaul UI correction). `maximumDiscountPercent` belongs to
 *  this level alone — no field is shared across Internal/Floor/Partner/
 *  Government/Enterprise/Corporate. The level's Selling Price itself stays
 *  in that SKU's existing flat tier-price field (`internalPrice` etc.) —
 *  this record only tracks "is this level enabled" + its own discount cap. */
export interface SkuPricingLevelSetting {
  level: PricingLevelKey
  maximumDiscountPercent: number
}

export type CreateSkuInput = Omit<
  CommercialSku,
  'id' | 'skuCode' | 'createdAt' | 'createdBy' | 'displayOrder' | 'isSellable' | 'lifecycleStatus' | 'editionId'
  | 'minimumAllowedPrice' | 'maximumDiscountPercent' | 'selectedPricingLevels'
> & {
  editionId?: string
  displayOrder?: number
  isSellable?: boolean
  lifecycleStatus?: CommercialSku['lifecycleStatus']
  minimumAllowedPrice?: number
  maximumDiscountPercent?: number
  selectedPricingLevels?: SkuPricingLevelSetting[]
}

// --- Commercial BOM (spec §6.4) -------------------------------------------

export interface CommercialBomItem {
  id: string
  parentSkuId: string
  componentSkuId: string
  mandatory: boolean
  quantity: number
  notes: string
}

export type CreateBomItemInput = Omit<CommercialBomItem, 'id'>

// --- BOQ (spec §6.5) -------------------------------------------------------

export type BoqStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'cancelled' | 'archived'

export interface CommercialBoq {
  id: string
  boqNumber: string
  opportunityName: string
  departmentId: string
  customerName: string
  /** The following three fields extend the FRS §12 Customer Information
   *  section beyond the original spec's `customerName`-only design —
   *  free text, same treatment (spec §12.2: no customer master exists
   *  in GOMS today). GST was removed from this section entirely (BOQ
   *  editable-workspace overhaul spec §8) — tax stays governed solely by
   *  `taxClassId` → `masters.taxClasses.ratePct` → line `taxPct`. */
  customerOrganization: string
  customerAddress: string
  customerContact: string
  verticalId: string

  budgetAmount: string
  budgetUnit: string
  budgetKnown: string
  emdAmount: string
  emdUnit: string

  salesPersonId: string
  buSalesPersonId: string | null
  preSalesId: string | null

  status: BoqStatus
  boqVersion: number
  revisionNumber: number
  parentBoqId: string | null

  currency: string
  grandTotal: number

  createdAt: string
  createdBy: string | null
  lastModifiedAt: string
  lastModifiedBy: string | null
}

export interface CommercialBoqLineItem {
  id: string
  boqId: string
  skuId: string
  quantity: number
  unitPrice: number
  discountPct: number
  taxPct: number
  /** → `Employee.id` (outside this module's own slice of `GormsData`, same
   *  as `CommercialBoq.salesPersonId`/`departmentId` — a plain FK resolved
   *  to a display name in the UI layer, not inside this module's own
   *  logic). `null` until a decision is made on this line. A stable
   *  reference rather than a free-text name, so approval history/reporting
   *  by person stays reliable even if that person's name changes. */
  approverId: string | null
  approvalDate: string | null
  approvalRemarks: string
  approvalStatus: 'auto_approved' | 'pending' | 'approved' | 'rejected'
  lineTotal: number
  /** Levels the user has explicitly added via "+ Add Pricing Level" —
   *  empty by default. Never has two entries with the same `level`. */
  pricingLevels: LinePricingLevel[]
  /** Which `pricingLevels` entry currently drives `unitPrice`/`discountPct`.
   *  `null` = no active level; the line falls back to its own stored
   *  `unitPrice`/`discountPct` exactly as it did before this field existed. */
  activePricingLevel: PricingLevelKey | null
}

export type CreateBoqInput = Omit<
  CommercialBoq,
  'id' | 'boqNumber' | 'status' | 'boqVersion' | 'revisionNumber' | 'parentBoqId' | 'grandTotal'
  | 'createdAt' | 'createdBy' | 'lastModifiedAt' | 'lastModifiedBy'
>

/** BOQ-level metadata patch (BOQ editable-workspace overhaul spec §3) —
 *  every field `CreateBoq.tsx` sets at creation time, all still editable
 *  while the BOQ stays in Draft. `customerGst` is not here — it no longer
 *  exists on `CommercialBoq` at all (spec §8). */
export type UpdateBoqInput = Partial<Pick<CommercialBoq,
  'opportunityName' | 'departmentId' | 'customerName' | 'customerOrganization' | 'customerAddress' | 'customerContact'
  | 'verticalId' | 'budgetAmount' | 'budgetUnit' | 'budgetKnown' | 'emdAmount' | 'emdUnit'
  | 'salesPersonId' | 'buSalesPersonId' | 'preSalesId' | 'currency'
>>

export interface CreateBoqLineItemInput {
  skuId: string
  quantity: number
  unitPrice: number
  discountPct: number
  approverId?: string | null
  approvalRemarks?: string
  pricingLevels?: LinePricingLevel[]
  activePricingLevel?: PricingLevelKey | null
}

// --- Audit Log (spec §6.6) -------------------------------------------------

export interface CommercialAuditLog {
  id: string
  entityType: string
  entityId: string
  field: string
  oldValue: string
  newValue: string
  reason: string
  action: string
  changedAt: string
  changedBy: string | null
}

/** The module's entire persisted slice of `GormsData`. */
export interface CommercialCalculatorData {
  masters: MastersState
  productEditionFeatures: ProductEditionFeature[]
  commercialSkus: CommercialSku[]
  commercialBomItems: CommercialBomItem[]
  commercialBoqs: CommercialBoq[]
  commercialBoqLineItems: CommercialBoqLineItem[]
  commercialAuditLogs: CommercialAuditLog[]
  /** Year (as a string key, e.g. "2026") → last-used sequence number.
   *  Spec §9 — BOQ numbers are year-scoped but the counter is never reset. */
  boqSequenceByYear: Record<string, number>
}
