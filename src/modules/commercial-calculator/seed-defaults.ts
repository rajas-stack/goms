import { WORK_VERTICALS } from '@/features/nodes/department-meta'
import type {
  ApprovalMatrixRule, BillingType, CommercialCalculatorData, CommercialProduct, CommercialSku, Currency,
  MastersState, PreSales, ProductEdition, ProductFeature, ProductModule, SkuCategory, TaxClass, UnitOfMeasure,
  Vertical,
} from './types'

/** Seeded from Account Mapping's own `WORK_VERTICALS` (the list every
 *  Opportunity's "Vertical" field already draws from) rather than left empty
 *  for admin population — the two are meant to be the same set of verticals,
 *  not independently maintained lists. Codes are short, SKU-code-safe
 *  abbreviations; `id`s are fixed like every other seeded master row. */
export const VERTICALS: Vertical[] = [
  { id: 'vert_traffic', code: 'TRAF', name: 'Traffic', description: '', active: true, displayOrder: 0 },
  { id: 'vert_transit', code: 'TRANSIT', name: 'Transit (Mobility)', description: '', active: true, displayOrder: 1 },
  { id: 'vert_data_fabric', code: 'DATA', name: 'Data Fabric & AI', description: '', active: true, displayOrder: 2 },
  { id: 'vert_smart_city', code: 'SMARTCITY', name: 'Integrated (Smart City)', description: '', active: true, displayOrder: 3 },
  { id: 'vert_gis', code: 'GIS', name: 'GIS', description: '', active: true, displayOrder: 4 },
  { id: 'vert_agriculture', code: 'AGRI', name: 'Agriculture', description: '', active: true, displayOrder: 5 },
  { id: 'vert_resource_utility', code: 'UTILITY', name: 'Resource & Utility', description: '', active: true, displayOrder: 6 },
  { id: 'vert_cloud', code: 'CLOUD', name: 'Cloud', description: '', active: true, displayOrder: 7 },
]

// Fails loudly (at import time, in dev/test) rather than silently drifting
// if WORK_VERTICALS is ever edited without updating the seed list above.
if (VERTICALS.length !== WORK_VERTICALS.length || VERTICALS.some((v, i) => v.name !== WORK_VERTICALS[i])) {
  throw new Error('commercial-calculator VERTICALS has drifted out of sync with department-meta.ts WORK_VERTICALS.')
}

/** AMNEX's real product lineup (per the company's "Verticals & Products"
 *  reference sheet), grouped under the matching `VERTICALS` row above — seeded
 *  rather than left empty so the Create BOQ picker has real Products/SKUs to
 *  build a proposal from immediately, not just an empty admin shell.
 *  "Outline" is listed on the reference sheet under both Smart City and Data
 *  Fabric & AI — modeled once, under Smart City, since a Product has exactly
 *  one Vertical and master codes must be globally unique. */
export const PRODUCTS: CommercialProduct[] = [
  { id: 'prod_locomate', code: 'LOCOMATE', name: 'Locomate', description: 'An intelligent mobility platform designed to elevate commuter satisfaction by providing precise ETAs, a seamless payment system, robust planning and scheduling and more.', verticalId: 'vert_transit', active: true, displayOrder: 0 },
  { id: 'prod_rapidgo', code: 'RAPIDGO', name: 'Rapidgo', description: 'An advanced journey planning app optimizing travel by seamlessly connecting multimodal options, covering both first and last miles to trunk networks.', verticalId: 'vert_transit', active: true, displayOrder: 1 },
  { id: 'prod_xup', code: 'XUP', name: 'XUP', description: 'A seamless payment system that automates and streamlines transactions, ensuring a speedy and user-friendly experience.', verticalId: 'vert_transit', active: true, displayOrder: 2 },
  { id: 'prod_syncnex', code: 'SYNCNEX', name: 'Syncnex', description: 'An adaptive traffic signal system crafted to boost intersection performance by reducing congestion, improving safety, and minimizing accidents.', verticalId: 'vert_transit', active: true, displayOrder: 3 },
  { id: 'prod_elbtros', code: 'ELBTROS', name: 'Elbtros', description: 'An advanced highway management solution that optimizes performance by improving safety, minimizing accidents, and ensuring seamless toll collection.', verticalId: 'vert_transit', active: true, displayOrder: 4 },

  { id: 'prod_outline', code: 'OUTLINE', name: 'Outline', description: 'An integrated Command and Control platform that offers extensive operational insights with advanced analytics, facilitating informed decision-making across the city.', verticalId: 'vert_smart_city', active: true, displayOrder: 0 },
  { id: 'prod_spectator', code: 'SPECTATOR', name: 'Spectator', description: "An advanced 3D GIS platform that enables informed decision-making, by seamlessly analyzing spatial and non-spatial attributes across multiple dimensions.", verticalId: 'vert_smart_city', active: true, displayOrder: 1 },
  { id: 'prod_iion', code: 'IION', name: 'IIon', description: 'Intelligent streetlight solution that optimizes not only energy consumption but also reduce operation and maintenance costs, while enhancing safety with smart features.', verticalId: 'vert_smart_city', active: true, displayOrder: 2 },
  { id: 'prod_ecokeeper', code: 'ECOKEEPER', name: 'Ecokeeper', description: 'A smart waste management platform designed to optimize waste collection processes and significantly increase operational efficiency.', verticalId: 'vert_smart_city', active: true, displayOrder: 3 },
  { id: 'prod_spotlock', code: 'SPOTLOCK', name: 'Spotlock', description: "A multi-technology parking management system that streamlines payment and application for drivers' convenience.", verticalId: 'vert_smart_city', active: true, displayOrder: 4 },

  { id: 'prod_dreservoir', code: 'DRESERVOIR', name: 'Dreservoir', description: 'A data lake platform that facilitates the entire data value chain, including data mining, processing, analytics, and visualization.', verticalId: 'vert_data_fabric', active: true, displayOrder: 0 },
  { id: 'prod_blocsafe', code: 'BLOCSAFE', name: 'Blocsafe', description: 'A blockchain platform that ensures complete traceability, secure data storage, and effective information dissemination across the data value chain.', verticalId: 'vert_data_fabric', active: true, displayOrder: 1 },
  { id: 'prod_recloud', code: 'RECLOUD', name: 'Recloud', description: 'A cloud solution designed to restructure and enhance cloud deployments, aiming for optimal performance, cost efficiency, and scalability.', verticalId: 'vert_data_fabric', active: true, displayOrder: 2 },

  { id: 'prod_agrogate', code: 'AGROGATE', name: 'Agrogate', description: 'An intelligent agriculture analytics platform that generates predictive insights for informed decision-making along the entire value chain.', verticalId: 'vert_agriculture', active: true, displayOrder: 0 },
  { id: 'prod_agrogate_finance', code: 'AGROFIN', name: 'Agrogate Finance', description: 'An intelligent agriculture analytics platform that generates predictive insights for informed decision-making tailored for banks and insurers.', verticalId: 'vert_agriculture', active: true, displayOrder: 1 },
  { id: 'prod_croptrack', code: 'CROPTRACK', name: 'Croptrack', description: 'A multilingual agriculture mobile application that empowers farmers by providing insightful crop data and regulatory support.', verticalId: 'vert_agriculture', active: true, displayOrder: 2 },
  { id: 'prod_farmlive', code: 'FARMLIVE', name: 'Farmlive', description: 'A precision farming solution enabled by IoT, designed to enhance operations for farmers through insightful data and analytics.', verticalId: 'vert_agriculture', active: true, displayOrder: 3 },

  { id: 'prod_nirikshak', code: 'NIRIKSHAK', name: 'Nirikshak', description: 'A smart mining platform that is designed to track mineral resources and improve operation efficiency.', verticalId: 'vert_resource_utility', active: true, displayOrder: 0 },
  { id: 'prod_eargo', code: 'EARGO', name: 'Eargo', description: 'An intelligent energy monitoring platform engineered to optimize distribution while prioritizing safety & enhancing operational efficiency.', verticalId: 'vert_resource_utility', active: true, displayOrder: 1 },
  { id: 'prod_veintex', code: 'VEINTEX', name: 'Veintex', description: 'An automated smart utility platform that ensures safe, waste-free, and optimized distribution of resources like water, gas, and other fluids.', verticalId: 'vert_resource_utility', active: true, displayOrder: 2 },
  { id: 'prod_trackous', code: 'TRACKOUS', name: 'Trackous', description: 'A smart logistics platform that integrates and streamlines end-to-end fleet management while precisely tracking goods.', verticalId: 'vert_resource_utility', active: true, displayOrder: 3 },
  { id: 'prod_portvein', code: 'PORTVEIN', name: 'Portvein', description: 'A centralized digital part platform designed to streamline the smooth and efficient operation of ports of all sizes and complexities.', verticalId: 'vert_resource_utility', active: true, displayOrder: 4 },
  { id: 'prod_samarth', code: 'SAMARTH', name: 'Samarth', description: 'An equipment monitoring system that facilitates efficient operations and regular maintenance.', verticalId: 'vert_resource_utility', active: true, displayOrder: 5 },
  { id: 'prod_dairynex', code: 'DAIRYNEX', name: 'Dairynex', description: 'A centralized dairy management platform designed to elevate dairy operations.', verticalId: 'vert_resource_utility', active: true, displayOrder: 6 },
]

/** Sample Module/Feature test data — unlike `PRODUCTS`, these aren't an
 *  AMNEX reference list; Modules/Features are meant to be admin-populated
 *  through Settings → Catalog → Hierarchy (spec §6.1). Seeded here anyway so
 *  Create BOQ has something to exercise end-to-end out of the box, without
 *  depending on an admin having entered data first. */
export const MODULES: ProductModule[] = [
  { id: 'mod_tracking', code: 'TRACK', name: 'Real-Time Tracking', description: 'Live vehicle position and ETA services.', productId: 'prod_locomate', active: true, displayOrder: 0 },
  { id: 'mod_payments', code: 'PAY', name: 'Payments', description: 'In-app fare payment and ticketing.', productId: 'prod_locomate', active: true, displayOrder: 1 },
  { id: 'mod_signal_control', code: 'SIGCTL', name: 'Signal Control', description: 'Adaptive intersection signal timing.', productId: 'prod_syncnex', active: true, displayOrder: 0 },
  { id: 'mod_analytics', code: 'ANALYTICS', name: 'Analytics Dashboard', description: 'Operational analytics and reporting.', productId: 'prod_outline', active: true, displayOrder: 0 },
]

export const FEATURES: ProductFeature[] = [
  { id: 'feat_live_eta', code: 'ETA', name: 'Live Vehicle ETA', description: 'Real-time estimated time of arrival for tracked vehicles.', moduleId: 'mod_tracking', status: 'existing', active: true, displayOrder: 0 },
  { id: 'feat_route_opt', code: 'ROUTE', name: 'Route Optimization', description: 'Dynamic route recalculation based on live conditions.', moduleId: 'mod_tracking', status: 'existing', active: true, displayOrder: 1 },
  { id: 'feat_in_app_ticket', code: 'TICKET', name: 'In-App Ticketing', description: 'Fare purchase and validation within the rider app.', moduleId: 'mod_payments', status: 'existing', active: true, displayOrder: 0 },
  { id: 'feat_adaptive_timing', code: 'ADAPT', name: 'Adaptive Timing', description: 'Signal timing that adjusts to real-time traffic volume.', moduleId: 'mod_signal_control', status: 'existing', active: true, displayOrder: 0 },
  { id: 'feat_evp', code: 'EVP', name: 'Emergency Vehicle Preemption', description: 'Priority signal clearance for approaching emergency vehicles.', moduleId: 'mod_signal_control', status: 'new', active: true, displayOrder: 1 },
  { id: 'feat_incident_detect', code: 'INCIDENT', name: 'Incident Detection', description: 'Automated flagging of anomalies from live camera/sensor feeds.', moduleId: 'mod_analytics', status: 'existing', active: true, displayOrder: 0 },
]

export const PRE_SALES: PreSales[] = [
  { id: 'presales_arjun', code: 'PS-ARJUN', name: 'Arjun Mehta', description: 'Pre-sales — Transit & Mobility.', active: true, displayOrder: 0 },
  { id: 'presales_kavya', code: 'PS-KAVYA', name: 'Kavya Nair', description: 'Pre-sales — Smart City & Data Fabric.', active: true, displayOrder: 1 },
]

// PCS-016 defaults.
export const SKU_CATEGORIES: SkuCategory[] = [
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

export const UNITS_OF_MEASURE: UnitOfMeasure[] = [
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
export const PRODUCT_EDITIONS: ProductEdition[] = [
  { id: 'ped_standard', code: 'STD', name: 'Standard', description: 'System default edition', active: true, displayOrder: 0 },
  { id: 'ped_professional', code: 'PRO', name: 'Professional', description: '', active: true, displayOrder: 1 },
  { id: 'ped_enterprise', code: 'ENT', name: 'Enterprise', description: '', active: true, displayOrder: 2 },
  { id: 'ped_government', code: 'GOV', name: 'Government', description: '', active: true, displayOrder: 3 },
  { id: 'ped_oem', code: 'OEM', name: 'OEM', description: '', active: true, displayOrder: 4 },
  { id: 'ped_custom', code: 'CUST', name: 'Custom', description: '', active: true, displayOrder: 5 },
]

export const STANDARD_EDITION_ID = 'ped_standard'

export const BILLING_TYPES: BillingType[] = [
  { id: 'bil_one_time', code: 'OT', name: 'One-Time', description: '', active: true, displayOrder: 0 },
  { id: 'bil_subscription', code: 'SUB', name: 'Subscription', description: '', active: true, displayOrder: 1 },
  { id: 'bil_usage_based', code: 'UB', name: 'Usage-Based', description: '', active: true, displayOrder: 2 },
  { id: 'bil_milestone_based', code: 'MB', name: 'Milestone-Based', description: '', active: true, displayOrder: 3 },
  { id: 'bil_perpetual_license', code: 'PERP', name: 'Perpetual License', description: '', active: true, displayOrder: 4 },
]

export const TAX_CLASSES: TaxClass[] = [
  { id: 'tax_gst18', code: 'GST18', name: 'GST 18%', description: 'Standard GST rate', ratePct: 18, active: true, displayOrder: 0 },
  { id: 'tax_gst12', code: 'GST12', name: 'GST 12%', description: '', ratePct: 12, active: true, displayOrder: 1 },
  { id: 'tax_gst5', code: 'GST5', name: 'GST 5%', description: '', ratePct: 5, active: true, displayOrder: 2 },
  { id: 'tax_exempt', code: 'EXEMPT', name: 'Exempt', description: '', ratePct: 0, active: true, displayOrder: 3 },
  { id: 'tax_nil_rated', code: 'NIL', name: 'Nil-Rated', description: '', ratePct: 0, active: true, displayOrder: 4 },
]

// PCS-028/029/030 — bands are contiguous and gap-free from 0% to the 90% ceiling.
export const APPROVAL_MATRIX: ApprovalMatrixRule[] = [
  { id: 'apr_0_10', code: 'AM1', name: '0-10%', description: '', minDiscountPct: 0, maxDiscountPct: 10, approvalLevelLabel: '', allowAutoApproval: true, active: true, displayOrder: 0 },
  { id: 'apr_10_25', code: 'AM2', name: '10-25%', description: '', minDiscountPct: 10, maxDiscountPct: 25, approvalLevelLabel: 'Sales Head', allowAutoApproval: false, active: true, displayOrder: 1 },
  { id: 'apr_25_50', code: 'AM3', name: '25-50%', description: '', minDiscountPct: 25, maxDiscountPct: 50, approvalLevelLabel: 'Regional Head', allowAutoApproval: false, active: true, displayOrder: 2 },
  { id: 'apr_50_90', code: 'AM4', name: '50-90%', description: '', minDiscountPct: 50, maxDiscountPct: 90, approvalLevelLabel: 'CEO', allowAutoApproval: false, active: true, displayOrder: 3 },
]

export const CURRENCIES: Currency[] = [
  { id: 'cur_inr', code: 'INR', name: 'Indian Rupee', description: '', symbol: '₹', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: true, active: true, displayOrder: 0 },
  { id: 'cur_usd', code: 'USD', name: 'US Dollar', description: '', symbol: '$', decimalPlaces: 2, exchangeRate: 83, isBaseCurrency: false, active: true, displayOrder: 1 },
  { id: 'cur_eur', code: 'EUR', name: 'Euro', description: '', symbol: '€', decimalPlaces: 2, exchangeRate: 90, isBaseCurrency: false, active: true, displayOrder: 2 },
  { id: 'cur_gbp', code: 'GBP', name: 'British Pound', description: '', symbol: '£', decimalPlaces: 2, exchangeRate: 105, isBaseCurrency: false, active: true, displayOrder: 3 },
]

function buildDefaultMasters(): MastersState {
  return {
    verticals: VERTICALS.map((r) => ({ ...r })),
    products: PRODUCTS.map((r) => ({ ...r })),
    modules: MODULES.map((r) => ({ ...r })),
    features: FEATURES.map((r) => ({ ...r })),
    skuCategories: SKU_CATEGORIES.map((r) => ({ ...r })),
    unitsOfMeasure: UNITS_OF_MEASURE.map((r) => ({ ...r })),
    productEditions: PRODUCT_EDITIONS.map((r) => ({ ...r })),
    billingTypes: BILLING_TYPES.map((r) => ({ ...r })),
    taxClasses: TAX_CLASSES.map((r) => ({ ...r })),
    approvalMatrix: APPROVAL_MATRIX.map((r) => ({ ...r })),
    currencies: CURRENCIES.map((r) => ({ ...r })),
    preSales: PRE_SALES.map((r) => ({ ...r })),
  }
}

/** One active, sellable SKU per seeded `FEATURES` row, generated the same
 *  way `createSku` would (`{Vertical}-{Product}-{Module}-{Feature}-{STATUS}`),
 *  so Create BOQ's picker resolves a real SKU end-to-end without an admin
 *  having to create SKU Catalog rows first. Costs/pricing are illustrative
 *  test figures, not AMNEX price-list values. */
export const SAMPLE_SKUS: CommercialSku[] = [
  { id: 'sku_live_eta', skuCode: 'TRANSIT-LOCOMATE-TRACK-ETA-EXG', name: 'Live Vehicle ETA', categoryId: 'skc_feature', featureId: 'feat_live_eta', editionId: 'ped_standard', uomId: 'uom_license', currencyId: 'cur_inr', taxClassId: 'tax_gst18', billingTypeId: 'bil_subscription', activeFrom: '2026-01-01', activeTill: null, lifecycleStatus: 'active', isSellable: true, displayOrder: 0, baseSoftwareCost: 8000, implementationCostPerMM: 2000, integrationCost: 0, thirdPartyCost: 0, hardwareCost: 0, cloudCost: 500, supportCost: 500, trainingCost: 0, internalPrice: 11000, floorPrice: 13000, partnerPrice: 15000, governmentPrice: 16000, enterprisePrice: 18000, corporatePrice: 18000, listPrice: 18000, minimumAllowedPrice: 13000, maximumDiscountPercent: 30, createdAt: '2026-01-01T00:00:00.000Z', createdBy: null, selectedPricingLevels: [] },
  { id: 'sku_route_opt', skuCode: 'TRANSIT-LOCOMATE-TRACK-ROUTE-EXG', name: 'Route Optimization', categoryId: 'skc_feature', featureId: 'feat_route_opt', editionId: 'ped_standard', uomId: 'uom_license', currencyId: 'cur_inr', taxClassId: 'tax_gst18', billingTypeId: 'bil_subscription', activeFrom: '2026-01-01', activeTill: null, lifecycleStatus: 'active', isSellable: true, displayOrder: 1, baseSoftwareCost: 10000, implementationCostPerMM: 2500, integrationCost: 0, thirdPartyCost: 0, hardwareCost: 0, cloudCost: 800, supportCost: 700, trainingCost: 0, internalPrice: 14000, floorPrice: 16500, partnerPrice: 19000, governmentPrice: 20000, enterprisePrice: 22000, corporatePrice: 22000, listPrice: 22000, minimumAllowedPrice: 16500, maximumDiscountPercent: 30, createdAt: '2026-01-01T00:00:00.000Z', createdBy: null, selectedPricingLevels: [] },
  { id: 'sku_ticketing', skuCode: 'TRANSIT-LOCOMATE-PAY-TICKET-EXG', name: 'In-App Ticketing', categoryId: 'skc_feature', featureId: 'feat_in_app_ticket', editionId: 'ped_standard', uomId: 'uom_license', currencyId: 'cur_inr', taxClassId: 'tax_gst18', billingTypeId: 'bil_subscription', activeFrom: '2026-01-01', activeTill: null, lifecycleStatus: 'active', isSellable: true, displayOrder: 2, baseSoftwareCost: 9000, implementationCostPerMM: 3000, integrationCost: 1000, thirdPartyCost: 0, hardwareCost: 0, cloudCost: 600, supportCost: 600, trainingCost: 0, internalPrice: 14200, floorPrice: 16800, partnerPrice: 19500, governmentPrice: 20500, enterprisePrice: 23000, corporatePrice: 23000, listPrice: 23000, minimumAllowedPrice: 16800, maximumDiscountPercent: 30, createdAt: '2026-01-01T00:00:00.000Z', createdBy: null, selectedPricingLevels: [] },
  { id: 'sku_adaptive_timing', skuCode: 'TRANSIT-SYNCNEX-SIGCTL-ADAPT-EXG', name: 'Adaptive Timing', categoryId: 'skc_feature', featureId: 'feat_adaptive_timing', editionId: 'ped_standard', uomId: 'uom_instance', currencyId: 'cur_inr', taxClassId: 'tax_gst18', billingTypeId: 'bil_one_time', activeFrom: '2026-01-01', activeTill: null, lifecycleStatus: 'active', isSellable: true, displayOrder: 3, baseSoftwareCost: 25000, implementationCostPerMM: 8000, integrationCost: 4000, thirdPartyCost: 0, hardwareCost: 5000, cloudCost: 0, supportCost: 2000, trainingCost: 1000, internalPrice: 45000, floorPrice: 52000, partnerPrice: 58000, governmentPrice: 60000, enterprisePrice: 65000, corporatePrice: 65000, listPrice: 65000, minimumAllowedPrice: 52000, maximumDiscountPercent: 25, createdAt: '2026-01-01T00:00:00.000Z', createdBy: null, selectedPricingLevels: [] },
  { id: 'sku_evp', skuCode: 'TRANSIT-SYNCNEX-SIGCTL-EVP-NEW', name: 'Emergency Vehicle Preemption', categoryId: 'skc_feature', featureId: 'feat_evp', editionId: 'ped_standard', uomId: 'uom_instance', currencyId: 'cur_inr', taxClassId: 'tax_gst18', billingTypeId: 'bil_one_time', activeFrom: '2026-01-01', activeTill: null, lifecycleStatus: 'active', isSellable: true, displayOrder: 4, baseSoftwareCost: 30000, implementationCostPerMM: 9000, integrationCost: 6000, thirdPartyCost: 0, hardwareCost: 8000, cloudCost: 0, supportCost: 2500, trainingCost: 1500, internalPrice: 57000, floorPrice: 65000, partnerPrice: 72000, governmentPrice: 75000, enterprisePrice: 80000, corporatePrice: 80000, listPrice: 80000, minimumAllowedPrice: 65000, maximumDiscountPercent: 25, createdAt: '2026-01-01T00:00:00.000Z', createdBy: null, selectedPricingLevels: [] },
  { id: 'sku_incident_detect', skuCode: 'SMARTCITY-OUTLINE-ANALYTICS-INCIDENT-EXG', name: 'Incident Detection', categoryId: 'skc_feature', featureId: 'feat_incident_detect', editionId: 'ped_standard', uomId: 'uom_instance', currencyId: 'cur_inr', taxClassId: 'tax_gst18', billingTypeId: 'bil_subscription', activeFrom: '2026-01-01', activeTill: null, lifecycleStatus: 'active', isSellable: true, displayOrder: 5, baseSoftwareCost: 18000, implementationCostPerMM: 6000, integrationCost: 3000, thirdPartyCost: 0, hardwareCost: 0, cloudCost: 1500, supportCost: 1000, trainingCost: 500, internalPrice: 30000, floorPrice: 35000, partnerPrice: 39000, governmentPrice: 41000, enterprisePrice: 45000, corporatePrice: 45000, listPrice: 45000, minimumAllowedPrice: 35000, maximumDiscountPercent: 30, createdAt: '2026-01-01T00:00:00.000Z', createdBy: null, selectedPricingLevels: [] },
]

/** The module's full default data slice — what a fresh `GormsData.commercialCalculator`
 *  looks like, and what the migration seeds an upgraded snapshot with. */
export function buildDefaultCommercialCalculatorData(): CommercialCalculatorData {
  return {
    masters: buildDefaultMasters(),
    productEditionFeatures: [],
    commercialSkus: SAMPLE_SKUS.map((r) => ({ ...r })),
    commercialBomItems: [],
    commercialBoqs: [],
    commercialBoqLineItems: [],
    commercialAuditLogs: [],
    boqSequenceByYear: {},
  }
}
