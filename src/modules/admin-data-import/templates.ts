import * as XLSX from 'xlsx'
import type { ImportRow, ImportRows, SpreadsheetDomainKey } from './api'

export interface TemplateSheet {
  sheet: string
  columns: string[]
}

export const SPREADSHEET_DOMAIN_KEYS = [
  'organizationHierarchy', 'employees', 'salesRoster', 'commercialMastersCatalog',
  'commercialMastersFlat', 'currencies', 'taxClasses', 'approvalMatrix', 'skus', 'bom',
] as const satisfies readonly SpreadsheetDomainKey[]

const CATALOG_COLUMNS = ['Code', 'Name', 'Description', 'Active', 'Display Order', 'Parent Code']
const FLAT_COLUMNS = ['Code', 'Name', 'Description', 'Active', 'Display Order']

// Column lists are verbatim from the design spec's §2-§11 per-template
// sections. Sheet order is load-significant for the multi-sheet domains
// (Verticals -> Products -> Modules -> Features; Sales Persons -> Postings).
export const TEMPLATE_COLUMNS: Record<SpreadsheetDomainKey, TemplateSheet[]> = {
  organizationHierarchy: [
    { sheet: 'Organization Hierarchy', columns: ['Node Type', 'Name', 'Code', 'Parent Code', 'State Code', 'Status'] },
  ],
  employees: [
    {
      sheet: 'Employees',
      columns: ['Employee Code', 'Name', 'Designation', 'Email', 'Phone', 'Org Node Code', 'Manager Employee Code', 'Vacant', 'Status'],
    },
  ],
  salesRoster: [
    { sheet: 'Sales Persons', columns: ['Official Email', 'Name', 'Personal Email', 'Mobile', 'Alt Mobile', 'Joined On', 'Status'] },
    { sheet: 'Postings', columns: ['Sales Person Email', 'Designation', 'Tier Key', 'Manager Email', 'Office', 'Start Date', 'Reason'] },
  ],
  commercialMastersCatalog: [
    { sheet: 'Verticals', columns: CATALOG_COLUMNS },
    { sheet: 'Products', columns: CATALOG_COLUMNS },
    { sheet: 'Modules', columns: CATALOG_COLUMNS },
    { sheet: 'Features', columns: [...CATALOG_COLUMNS, 'Feature Status'] },
  ],
  commercialMastersFlat: [
    { sheet: 'SKU Categories', columns: FLAT_COLUMNS },
    { sheet: 'Units of Measure', columns: FLAT_COLUMNS },
    { sheet: 'Product Editions', columns: FLAT_COLUMNS },
    { sheet: 'Billing Types', columns: FLAT_COLUMNS },
  ],
  currencies: [
    {
      sheet: 'Currencies',
      columns: ['Code', 'Name', 'Symbol', 'Decimal Places', 'Exchange Rate', 'Is Base Currency', 'Active', 'Display Order'],
    },
  ],
  taxClasses: [
    { sheet: 'Tax Classes', columns: ['Code', 'Name', 'Description', 'Rate %', 'Active', 'Display Order'] },
  ],
  approvalMatrix: [
    {
      sheet: 'Approval Matrix',
      columns: ['Code', 'Name', 'Description', 'Min Discount %', 'Max Discount %', 'Approval Level Label', 'Allow Auto Approval', 'Active', 'Display Order'],
    },
  ],
  skus: [
    {
      sheet: 'SKUs',
      columns: [
        'SKU Code', 'Name', 'Category Code', 'Feature Code', 'Edition Code', 'UOM Code', 'Currency Code',
        'Tax Class Code', 'Billing Type Code', 'Active From', 'Active Till', 'Lifecycle Status', 'Is Sellable', 'Display Order',
        'Base Software Cost', 'Implementation Cost/MM', 'Integration Cost', 'Third Party Cost', 'Hardware Cost',
        'Cloud Cost', 'Support Cost', 'Training Cost',
        'Internal Price', 'Floor Price', 'Partner Price', 'Government Price', 'Enterprise Price', 'Corporate Price',
        'List Price', 'Minimum Allowed Price', 'Maximum Discount %',
      ],
    },
  ],
  bom: [
    { sheet: 'BOM', columns: ['Parent SKU Code', 'Component SKU Code', 'Mandatory', 'Quantity', 'Notes'] },
  ],
}

/** Spreadsheet header -> the field name each importer's Zod schema expects
 *  (apps/api/src/import/domains/*.ts). Headers are globally unique across
 *  every template, so one flat map covers all domains. */
export const HEADER_TO_FIELD: Record<string, string> = {
  'Code': 'code',
  'Name': 'name',
  'Description': 'description',
  'Active': 'active',
  'Display Order': 'displayOrder',
  'Parent Code': 'parentCode',
  'Status': 'status',
  'Feature Status': 'featureStatus',

  'Node Type': 'nodeType',
  'State Code': 'stateCode',

  'Employee Code': 'employeeCode',
  'Designation': 'designation',
  'Email': 'email',
  'Phone': 'phone',
  'Org Node Code': 'orgNodeCode',
  'Manager Employee Code': 'managerCode',
  'Vacant': 'vacant',

  'Official Email': 'officialEmail',
  'Personal Email': 'personalEmail',
  'Mobile': 'mobile',
  'Alt Mobile': 'altMobile',
  'Joined On': 'joinedOn',
  'Sales Person Email': 'salesPersonEmail',
  'Tier Key': 'tierKey',
  'Manager Email': 'managerEmail',
  'Office': 'office',
  'Start Date': 'startDate',
  'Reason': 'reason',

  'Symbol': 'symbol',
  'Decimal Places': 'decimalPlaces',
  'Exchange Rate': 'exchangeRate',
  'Is Base Currency': 'isBaseCurrency',

  'Rate %': 'ratePct',

  'Min Discount %': 'minDiscountPct',
  'Max Discount %': 'maxDiscountPct',
  'Approval Level Label': 'approvalLevelLabel',
  'Allow Auto Approval': 'allowAutoApproval',

  'SKU Code': 'skuCode',
  'Category Code': 'categoryCode',
  'Feature Code': 'featureCode',
  'Edition Code': 'editionCode',
  'UOM Code': 'uomCode',
  'Currency Code': 'currencyCode',
  'Tax Class Code': 'taxClassCode',
  'Billing Type Code': 'billingTypeCode',
  'Active From': 'activeFrom',
  'Active Till': 'activeTill',
  'Lifecycle Status': 'lifecycleStatus',
  'Is Sellable': 'isSellable',
  'Maximum Discount %': 'maximumDiscountPercent',
  'Base Software Cost': 'baseSoftwareCost',
  'Implementation Cost/MM': 'implementationCostPerMM',
  'Integration Cost': 'integrationCost',
  'Third Party Cost': 'thirdPartyCost',
  'Hardware Cost': 'hardwareCost',
  'Cloud Cost': 'cloudCost',
  'Support Cost': 'supportCost',
  'Training Cost': 'trainingCost',
  'Internal Price': 'internalPrice',
  'Floor Price': 'floorPrice',
  'Partner Price': 'partnerPrice',
  'Government Price': 'governmentPrice',
  'Enterprise Price': 'enterprisePrice',
  'Corporate Price': 'corporatePrice',
  'List Price': 'listPrice',
  'Minimum Allowed Price': 'minimumAllowedPrice',

  'Parent SKU Code': 'parentSkuCode',
  'Component SKU Code': 'componentSkuCode',
  'Mandatory': 'mandatory',
  'Quantity': 'quantity',
  'Notes': 'notes',
}

const BOOLEAN_FIELDS = new Set(['active', 'isBaseCurrency', 'vacant', 'isSellable', 'mandatory', 'allowAutoApproval'])

const NUMERIC_FIELDS = new Set([
  'displayOrder', 'stateCode', 'ratePct', 'decimalPlaces', 'exchangeRate',
  'minDiscountPct', 'maxDiscountPct', 'quantity', 'maximumDiscountPercent', 'minimumAllowedPrice',
  'baseSoftwareCost', 'implementationCostPerMM', 'integrationCost', 'thirdPartyCost', 'hardwareCost',
  'cloudCost', 'supportCost', 'trainingCost',
  'internalPrice', 'floorPrice', 'partnerPrice', 'governmentPrice', 'enterprisePrice', 'corporatePrice', 'listPrice',
])

const TRUE_SPELLINGS = new Set(['y', 'yes', 'true', '1'])
const FALSE_SPELLINGS = new Set(['n', 'no', 'false', '0'])

/** Coerces one spreadsheet cell into the shape its importer's Zod schema
 *  expects. A value that can't be coerced is passed through untouched, so
 *  the backend rejects it with its own real per-field message rather than
 *  this layer silently swallowing or zeroing it. */
export function parseCellValue(field: string, raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined
  const text = typeof raw === 'string' ? raw.trim() : raw

  if (BOOLEAN_FIELDS.has(field)) {
    if (typeof text === 'boolean') return text
    const lowered = String(text).toLowerCase()
    if (TRUE_SPELLINGS.has(lowered)) return true
    if (FALSE_SPELLINGS.has(lowered)) return false
    return text
  }

  if (NUMERIC_FIELDS.has(field)) {
    if (typeof text === 'number') return text
    if (text === '') return undefined
    const parsed = Number(text)
    return Number.isNaN(parsed) ? text : parsed
  }

  return text
}

function rowsFromSheet(worksheet: XLSX.WorkSheet): ImportRow[] {
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '', raw: false })
  return raw.map((rawRow) => {
    const row: ImportRow = {}
    for (const [header, value] of Object.entries(rawRow)) {
      const field = HEADER_TO_FIELD[header.trim()]
      if (!field) continue
      const parsed = parseCellValue(field, value)
      if (parsed !== undefined) row[field] = parsed
    }
    return row
  })
}

/** Multi-sheet domains submit a `{ sheetKey: rows[] }` dictionary; the keys
 *  are the importer's own internal names, not the human sheet titles. */
const MULTI_SHEET_KEYS: Partial<Record<SpreadsheetDomainKey, Record<string, string>>> = {
  commercialMastersCatalog: { Verticals: 'verticals', Products: 'products', Modules: 'modules', Features: 'features' },
  commercialMastersFlat: {
    'SKU Categories': 'skuCategories', 'Units of Measure': 'unitsOfMeasure',
    'Product Editions': 'productEditions', 'Billing Types': 'billingTypes',
  },
  salesRoster: { 'Sales Persons': 'persons', Postings: 'postings' },
}

function sheetHeaders(worksheet: XLSX.WorkSheet): string[] {
  const [headerRow] = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, blankrows: false })
  return (headerRow ?? []).map((h) => String(h).trim())
}

export class UnrecognizedWorkbookError extends Error {}

/** Parses an uploaded workbook into exactly the `rows` shape
 *  `adminImport.validate` expects for this domain. Rows that are entirely
 *  blank are dropped, so a template's trailing empty rows don't become
 *  rejected rows in the preview.
 *
 *  Throws `UnrecognizedWorkbookError` when no sheet carries any of this
 *  domain's expected headers. SheetJS parses arbitrary bytes leniently
 *  rather than throwing, so without this check a wrong-template or
 *  not-a-spreadsheet upload would silently validate as zero rows —
 *  indistinguishable from a correctly-filled-but-empty template. */
export function parseWorkbook(domain: SpreadsheetDomainKey, data: ArrayBuffer): ImportRows {
  const workbook = XLSX.read(data, { type: 'array' })
  const sheetKeys = MULTI_SHEET_KEYS[domain]
  const isBlank = (row: ImportRow) => Object.values(row).every((v) => v === '' || v === undefined)

  const expectedHeaders = new Set(TEMPLATE_COLUMNS[domain].flatMap((s) => s.columns))
  const foundAnyExpectedHeader = workbook.SheetNames.some((name) =>
    sheetHeaders(workbook.Sheets[name]).some((h) => expectedHeaders.has(h)),
  )
  if (!foundAnyExpectedHeader) {
    throw new UnrecognizedWorkbookError(`No ${domain} columns found in this workbook.`)
  }

  if (!sheetKeys) {
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
    return firstSheet ? rowsFromSheet(firstSheet).filter((r) => !isBlank(r)) : []
  }

  const result: Record<string, ImportRow[]> = {}
  for (const [sheetTitle, key] of Object.entries(sheetKeys)) {
    const worksheet = workbook.Sheets[sheetTitle]
    result[key] = worksheet ? rowsFromSheet(worksheet).filter((r) => !isBlank(r)) : []
  }
  return result
}

/** Generates and downloads a header-only workbook for this domain. Only
 *  Geography ships pre-filled data, and it has no template at all. */
export function downloadTemplate(domain: SpreadsheetDomainKey): void {
  const workbook = XLSX.utils.book_new()
  for (const { sheet, columns } of TEMPLATE_COLUMNS[domain]) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([columns]), sheet)
  }
  XLSX.writeFile(workbook, `goms-import-template-${domain}.xlsx`)
}
