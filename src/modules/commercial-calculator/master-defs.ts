import type { FeatureStatus, MasterEntityKey } from './types'

export interface MasterFieldDef {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select'
  required?: boolean
  /** Static options for a plain select (e.g. Feature status). */
  options?: { value: string; label: string }[]
  /** For an FK select: which master's active rows populate the dropdown.
   *  At most one field per master may set this — the form dialog assumes
   *  a single parent relationship. */
  parentMasterKey?: MasterEntityKey
}

export interface MasterDef {
  label: string
  singularLabel: string
  /** Extra fields beyond the code/name/description/active/displayOrder every
   *  master already has via `MasterBase` — see types.ts. */
  fields: MasterFieldDef[]
}

const FEATURE_STATUS_OPTIONS: { value: FeatureStatus; label: string }[] = [
  { value: 'existing', label: 'Existing' },
  { value: 'modified', label: 'Modified' },
  { value: 'new', label: 'New' },
]

export const MASTER_DEFS: Record<MasterEntityKey, MasterDef> = {
  verticals: { label: 'Verticals', singularLabel: 'Vertical', fields: [] },
  products: {
    label: 'Products', singularLabel: 'Product',
    fields: [{ key: 'verticalId', label: 'Vertical', type: 'select', required: true, parentMasterKey: 'verticals' }],
  },
  modules: {
    label: 'Modules', singularLabel: 'Module',
    fields: [{ key: 'productId', label: 'Product', type: 'select', required: true, parentMasterKey: 'products' }],
  },
  features: {
    label: 'Features', singularLabel: 'Feature',
    fields: [
      { key: 'moduleId', label: 'Module', type: 'select', required: true, parentMasterKey: 'modules' },
      { key: 'status', label: 'Status', type: 'select', required: true, options: FEATURE_STATUS_OPTIONS },
    ],
  },
  skuCategories: { label: 'SKU Categories', singularLabel: 'SKU Category', fields: [] },
  unitsOfMeasure: { label: 'Units of Measure', singularLabel: 'Unit of Measure', fields: [] },
  productEditions: { label: 'Product Editions', singularLabel: 'Product Edition', fields: [] },
  billingTypes: { label: 'Billing Types', singularLabel: 'Billing Type', fields: [] },
  taxClasses: {
    label: 'Tax Classes', singularLabel: 'Tax Class',
    fields: [{ key: 'ratePct', label: 'Rate %', type: 'number', required: true }],
  },
  approvalMatrix: {
    label: 'Approval Matrix', singularLabel: 'Approval Band',
    fields: [
      { key: 'minDiscountPct', label: 'Min Discount %', type: 'number', required: true },
      { key: 'maxDiscountPct', label: 'Max Discount %', type: 'number', required: true },
      { key: 'approvalLevelLabel', label: 'Approval Level', type: 'text' },
      { key: 'allowAutoApproval', label: 'Auto-approve', type: 'boolean' },
    ],
  },
  currencies: {
    label: 'Currencies', singularLabel: 'Currency',
    fields: [
      { key: 'symbol', label: 'Symbol', type: 'text', required: true },
      { key: 'decimalPlaces', label: 'Decimal Places', type: 'number', required: true },
      { key: 'exchangeRate', label: 'Exchange Rate', type: 'number', required: true },
      { key: 'isBaseCurrency', label: 'Base Currency', type: 'boolean' },
    ],
  },
  preSales: { label: 'Pre-Sales', singularLabel: 'Pre-Sales Executive', fields: [] },
}

/** Tab/sub-nav order for the Masters section — matches spec §6.1's table order. */
export const MASTER_ORDER: MasterEntityKey[] = [
  'verticals', 'products', 'modules', 'features', 'skuCategories', 'unitsOfMeasure',
  'productEditions', 'billingTypes', 'taxClasses', 'approvalMatrix', 'currencies', 'preSales',
]
