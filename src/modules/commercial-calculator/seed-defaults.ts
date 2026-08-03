import type {
  ApprovalMatrixRule, BillingType, CommercialCalculatorData, Currency, MastersState, ProductEdition,
  SkuCategory, TaxClass, UnitOfMeasure,
} from './types'

// PCS-016 defaults.
const SKU_CATEGORIES: SkuCategory[] = [
  { id: 'skc_software', code: 'SW', name: 'Software', description: 'Core software licenses', active: true, displayOrder: 0 },
  { id: 'skc_module', code: 'MOD', name: 'Module', description: 'Add-on functional modules', active: true, displayOrder: 1 },
  { id: 'skc_feature', code: 'FEA', name: 'Feature', description: 'Individual sellable features', active: true, displayOrder: 2 },
  { id: 'skc_implementation', code: 'IMPL', name: 'Implementation', description: 'Implementation services', active: true, displayOrder: 3 },
  { id: 'skc_integration', code: 'INTEG', name: 'Integration', description: 'Third-system integration work', active: true, displayOrder: 4 },
  { id: 'skc_third_party', code: 'TP', name: 'Third Party', description: 'Third-party product resale', active: true, displayOrder: 5 },
  { id: 'skc_hardware', code: 'HW', name: 'Hardware', description: 'Physical hardware line items', active: true, displayOrder: 6 },
  { id: 'skc_cloud', code: 'CLOUD', name: 'Cloud', description: 'Cloud hosting/infrastructure', active: true, displayOrder: 7 },
  { id: 'skc_training', code: 'TRAIN', name: 'Training', description: 'End-user/admin training', active: true, displayOrder: 8 },
  { id: 'skc_support', code: 'SUPP', name: 'Support', description: 'Post-go-live support', active: true, displayOrder: 9 },
  { id: 'skc_subscription', code: 'SUB', name: 'Subscription', description: 'Recurring subscription line items', active: true, displayOrder: 10 },
  { id: 'skc_professional_services', code: 'PROF', name: 'Professional Services', description: 'Consulting/advisory services', active: true, displayOrder: 11 },
]

const UNITS_OF_MEASURE: UnitOfMeasure[] = [
  { id: 'uom_license', code: 'LIC', name: 'License', description: '', active: true, displayOrder: 0 },
  { id: 'uom_user', code: 'USER', name: 'User', description: '', active: true, displayOrder: 1 },
  { id: 'uom_month', code: 'MONTH', name: 'Month', description: '', active: true, displayOrder: 2 },
  { id: 'uom_instance', code: 'INST', name: 'Instance', description: '', active: true, displayOrder: 3 },
  { id: 'uom_device', code: 'DEV', name: 'Device', description: '', active: true, displayOrder: 4 },
  { id: 'uom_gb', code: 'GB', name: 'GB', description: '', active: true, displayOrder: 5 },
]

/** `ped_standard` (code `STD`) is the system default — `CommercialSku.editionId`
 *  falls back to this id when a SKU is created without one (Phase 2). Its id
 *  is fixed rather than looked up by code so that fallback is a constant, not
 *  a runtime search. */
const PRODUCT_EDITIONS: ProductEdition[] = [
  { id: 'ped_standard', code: 'STD', name: 'Standard', description: 'System default edition', active: true, displayOrder: 0 },
  { id: 'ped_professional', code: 'PRO', name: 'Professional', description: '', active: true, displayOrder: 1 },
  { id: 'ped_enterprise', code: 'ENT', name: 'Enterprise', description: '', active: true, displayOrder: 2 },
  { id: 'ped_government', code: 'GOV', name: 'Government', description: '', active: true, displayOrder: 3 },
  { id: 'ped_oem', code: 'OEM', name: 'OEM', description: '', active: true, displayOrder: 4 },
  { id: 'ped_custom', code: 'CUST', name: 'Custom', description: '', active: true, displayOrder: 5 },
]

export const STANDARD_EDITION_ID = 'ped_standard'

const BILLING_TYPES: BillingType[] = [
  { id: 'bil_one_time', code: 'OT', name: 'One-Time', description: '', active: true, displayOrder: 0 },
  { id: 'bil_subscription', code: 'SUB', name: 'Subscription', description: '', active: true, displayOrder: 1 },
  { id: 'bil_usage_based', code: 'UB', name: 'Usage-Based', description: '', active: true, displayOrder: 2 },
  { id: 'bil_milestone_based', code: 'MB', name: 'Milestone-Based', description: '', active: true, displayOrder: 3 },
  { id: 'bil_perpetual_license', code: 'PERP', name: 'Perpetual License', description: '', active: true, displayOrder: 4 },
]

const TAX_CLASSES: TaxClass[] = [
  { id: 'tax_gst18', code: 'GST18', name: 'GST 18%', description: 'Standard GST rate', ratePct: 18, active: true, displayOrder: 0 },
  { id: 'tax_gst12', code: 'GST12', name: 'GST 12%', description: '', ratePct: 12, active: true, displayOrder: 1 },
  { id: 'tax_gst5', code: 'GST5', name: 'GST 5%', description: '', ratePct: 5, active: true, displayOrder: 2 },
  { id: 'tax_exempt', code: 'EXEMPT', name: 'Exempt', description: '', ratePct: 0, active: true, displayOrder: 3 },
  { id: 'tax_nil_rated', code: 'NIL', name: 'Nil-Rated', description: '', ratePct: 0, active: true, displayOrder: 4 },
]

// PCS-028/029/030 — bands are contiguous and gap-free from 0% to the 90% ceiling.
const APPROVAL_MATRIX: ApprovalMatrixRule[] = [
  { id: 'apr_0_10', code: 'AM1', name: '0-10%', description: '', minDiscountPct: 0, maxDiscountPct: 10, approvalLevelLabel: '', allowAutoApproval: true, active: true, displayOrder: 0 },
  { id: 'apr_10_25', code: 'AM2', name: '10-25%', description: '', minDiscountPct: 10, maxDiscountPct: 25, approvalLevelLabel: 'Sales Head', allowAutoApproval: false, active: true, displayOrder: 1 },
  { id: 'apr_25_50', code: 'AM3', name: '25-50%', description: '', minDiscountPct: 25, maxDiscountPct: 50, approvalLevelLabel: 'Regional Head', allowAutoApproval: false, active: true, displayOrder: 2 },
  { id: 'apr_50_90', code: 'AM4', name: '50-90%', description: '', minDiscountPct: 50, maxDiscountPct: 90, approvalLevelLabel: 'CEO', allowAutoApproval: false, active: true, displayOrder: 3 },
]

const CURRENCIES: Currency[] = [
  { id: 'cur_inr', code: 'INR', name: 'Indian Rupee', description: '', symbol: '₹', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: true, active: true, displayOrder: 0 },
  { id: 'cur_usd', code: 'USD', name: 'US Dollar', description: '', symbol: '$', decimalPlaces: 2, exchangeRate: 83, isBaseCurrency: false, active: true, displayOrder: 1 },
  { id: 'cur_eur', code: 'EUR', name: 'Euro', description: '', symbol: '€', decimalPlaces: 2, exchangeRate: 90, isBaseCurrency: false, active: true, displayOrder: 2 },
  { id: 'cur_gbp', code: 'GBP', name: 'British Pound', description: '', symbol: '£', decimalPlaces: 2, exchangeRate: 105, isBaseCurrency: false, active: true, displayOrder: 3 },
]

function buildDefaultMasters(): MastersState {
  return {
    verticals: [],
    products: [],
    modules: [],
    features: [],
    skuCategories: SKU_CATEGORIES.map((r) => ({ ...r })),
    unitsOfMeasure: UNITS_OF_MEASURE.map((r) => ({ ...r })),
    productEditions: PRODUCT_EDITIONS.map((r) => ({ ...r })),
    billingTypes: BILLING_TYPES.map((r) => ({ ...r })),
    taxClasses: TAX_CLASSES.map((r) => ({ ...r })),
    approvalMatrix: APPROVAL_MATRIX.map((r) => ({ ...r })),
    currencies: CURRENCIES.map((r) => ({ ...r })),
    preSales: [],
  }
}

/** The module's full default data slice — what a fresh `GormsData.commercialCalculator`
 *  looks like, and what the migration seeds an upgraded snapshot with. */
export function buildDefaultCommercialCalculatorData(): CommercialCalculatorData {
  return {
    masters: buildDefaultMasters(),
    productEditionFeatures: [],
    commercialSkus: [],
    commercialBomItems: [],
    commercialBoqs: [],
    commercialBoqLineItems: [],
    commercialAuditLogs: [],
    boqSequenceByYear: {},
  }
}
