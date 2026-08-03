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

/** The module's entire persisted slice of `GormsData`. Every future
 *  Commercial Calculator collection (SKUs, BOQs, audit log — later phases)
 *  is a field added HERE, not a new top-level `GormsData` field. */
export interface CommercialCalculatorData {
  masters: MastersState
  productEditionFeatures: ProductEditionFeature[]
}
