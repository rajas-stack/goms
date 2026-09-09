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
      columns: ['Employee Code', 'Name', 'Designation', 'Email', 'Phone', 'Org Node Code', 'Manager Employee Code', 'Vacant', 'Status', 'Department Head Of'],
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
    { sheet: 'Pre-Sales', columns: FLAT_COLUMNS },
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
  'Department Head Of': 'departmentHeadOf',

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

  // Aliases — organizationHierarchy
  'Type': 'nodeType', 'Org Type': 'nodeType',
  'Node Code': 'code',
  'Parent': 'parentCode', 'Reports To Code': 'parentCode',

  // Aliases — employees
  'Emp Code': 'employeeCode', 'Employee ID': 'employeeCode', 'EmpCode': 'employeeCode',
  'Full Name': 'name', 'Employee Name': 'name',
  'Job Title': 'designation', 'Role': 'designation',
  // 'Org Code' means "which org node this employee belongs to" here, not
  // organizationHierarchy's own Code column — headers are globally unique
  // across every template, so this one spelling belongs to exactly one field.
  'Org Code': 'orgNodeCode', 'Department Code': 'orgNodeCode', 'Office Code': 'orgNodeCode',
  'Manager Code': 'managerCode', 'Reporting Manager Code': 'managerCode', 'Manager Emp Code': 'managerCode',
  'Employee Status': 'status',
  'Is Vacant': 'vacant', 'Vacant Position': 'vacant',
  'Dept Head Of': 'departmentHeadOf',

  // Aliases — salesRoster (Sales Persons)
  'Work Email': 'officialEmail', 'Email Address': 'officialEmail',

  // Aliases — salesRoster (Postings)
  'Person Email': 'salesPersonEmail', "Sales Person's Email": 'salesPersonEmail',
  'Reporting Manager Email': 'managerEmail',
  'Office Name': 'office', 'Location': 'office',

  // Aliases — commercial masters / SKUs
  'Product Code': 'skuCode', 'Item Code': 'skuCode',
  'Category': 'categoryCode', 'SKU Category': 'categoryCode',
  'Feature': 'featureCode',
  'Edition': 'editionCode', 'Product Edition': 'editionCode',
  'UOM': 'uomCode', 'Unit of Measure': 'uomCode',
  'Currency': 'currencyCode',
  'Tax Class': 'taxClassCode',
  'Billing Type': 'billingTypeCode',
  'SKU Name': 'name',
  'Sellable': 'isSellable',
  'Parent SKU': 'parentSkuCode',
  'Component SKU': 'componentSkuCode',

  // Aliases — realistic/business-export header variants seen in real admin
  // exports (README/QA fixtures) rather than the app's own template. Each
  // is checked against every other header spelling already in this map
  // before being added, to confirm it names the same field everywhere it
  // could plausibly appear — see DOMAIN_HEADER_OVERRIDES just below for the
  // two spellings that genuinely mean different things per domain and so
  // can't live in this shared, domain-agnostic map.
  'Organization Name': 'name',
  'Parent Org Code': 'parentCode',
  'Parent Organization Code': 'parentCode',
  'Employee No': 'employeeCode',
  'Mobile No': 'mobile',
  'Current Designation': 'designation',
  'Tier': 'tierKey',
  'Office / Location': 'office',
  'Office / Posting': 'office',
  'Effective From': 'startDate',
  'Reason for Change': 'reason',
  'Change Reason': 'reason',
  'Tax Code': 'code',
  'Tax Name': 'name',
  'Tax Rate %': 'ratePct',
  'Currency Name': 'name',
  'Base Currency': 'isBaseCurrency',
  'Reporting Manager Employee ID': 'managerCode',
  'Employment Status': 'status',
  'Joining Date': 'joinedOn',
  'Band Code': 'code',
  'SKU Category Code': 'categoryCode',
  // Not a real schema field on any domain — purely a signal sessionUpload.ts
  // uses to recognize and decompose a combined, Level-discriminated
  // Commercial Catalog sheet (Vertical/Product/Module/Feature rows mixed
  // together) into the four separate sheets commercialMastersCatalog
  // actually expects. Stripped back out before any row reaches a real
  // domain schema.
  'Level': 'catalogLevel',
  // "Organization Code" defaults to employees' meaning (which org an
  // employee belongs to) — matching the existing "Org Code"/"Department
  // Code"/"Office Code" family — overridden below for organizationHierarchy
  // itself, where the identical words name the node's OWN code.
  'Organization Code': 'orgNodeCode',
}

/** Header spellings whose real-world meaning genuinely depends on which
 *  domain they're read for — unlike every other header in HEADER_TO_FIELD,
 *  which names the same field no matter which template it appears on. "Org
 *  Code" already means "which org node an employee belongs to" (orgNodeCode)
 *  on the Employees sheet; a realistic Organization Hierarchy export uses
 *  the same words for the node's OWN code. "Work Email" already means a
 *  sales person's official email (salesRoster); a realistic Employees
 *  export uses it for the employee's own email. Checked before the global
 *  map (see resolveHeaderField/headersForField below) — every other header
 *  is untouched by this table and keeps its single global meaning. */
export const DOMAIN_HEADER_OVERRIDES: Partial<Record<SpreadsheetDomainKey, Record<string, string>>> = {
  organizationHierarchy: { 'Org Code': 'code', 'Organization Code': 'code' },
  employees: { 'Work Email': 'email', 'Official Email': 'email' },
  // "Currency Code" already names skus' own canonical FK column
  // referencing which currency a SKU is priced in; a realistic Currencies
  // export uses the identical words for the currency row's OWN code instead.
  currencies: { 'Currency Code': 'code' },
  // "Product Code"/"Module Code" already name skus' own FK columns
  // referencing which product/module a feature belongs to commercially; a
  // realistic combined catalog export uses the identical words for each
  // catalog level's OWN parent-code column instead ("Vertical Code" has no
  // existing global meaning, but is scoped here too for the same reason —
  // all three read together as one family).
  commercialMastersCatalog: { 'Vertical Code': 'parentCode', 'Product Code': 'parentCode', 'Module Code': 'parentCode' },
}

/** Resolves one header spelling to the field it names for a given domain —
 *  the domain-scoped override if one exists, else the shared global
 *  mapping. `domain` is undefined for a sheet that hasn't been assigned a
 *  domain yet (still 'ambiguous'/'unrecognized', pending the admin's own
 *  choice in the UI) — those fall back to the global-only meaning, same as
 *  before this table existed. */
export function resolveHeaderField(domain: SpreadsheetDomainKey | undefined, header: string): string | undefined {
  const trimmed = header.trim()
  const override = domain && DOMAIN_HEADER_OVERRIDES[domain]?.[trimmed]
  return override || HEADER_TO_FIELD[trimmed]
}

/** Reverse of HEADER_TO_FIELD: every header spelling (canonical or alias)
 *  that resolves to a given field. Used by parseWorkbook's own-domain
 *  detection below, and by Task 19's per-sheet domain scorer — a single
 *  source of truth for "which headers count as recognizing this field",
 *  so the two can never drift apart. */
export const FIELD_TO_HEADERS: Record<string, string[]> = Object.entries(HEADER_TO_FIELD).reduce(
  (acc, [header, field]) => {
    (acc[field] ??= []).push(header)
    return acc
  },
  {} as Record<string, string[]>,
)

/** Every header spelling that resolves to `field` FOR THIS domain
 *  specifically — the global spellings (FIELD_TO_HEADERS) plus this
 *  domain's own DOMAIN_HEADER_OVERRIDES entries, if any. Domain detection
 *  scores each candidate domain against a sheet's headers (domainDetection.ts);
 *  using this instead of the raw global map lets a domain-scoped override
 *  spelling (e.g. "Org Code" for organizationHierarchy) count toward THAT
 *  domain's score without also counting toward every other domain that
 *  happens to share the same spelling for a different field. */
export function headersForField(domain: SpreadsheetDomainKey, field: string): string[] {
  const overrides = DOMAIN_HEADER_OVERRIDES[domain]
  const overrideHeaders = overrides
    ? Object.entries(overrides).filter(([, f]) => f === field).map(([h]) => h)
    : []
  return [...new Set([...(FIELD_TO_HEADERS[field] ?? []), ...overrideHeaders])]
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
    const parsed = Number(typeof text === 'string' ? stripNumericFormatting(text) : text)
    return Number.isNaN(parsed) ? text : parsed
  }

  return text
}

/** Strips ONLY unambiguous Excel numeric formatting — thousands-separator
 *  commas and a leading currency symbol — before parsing, so a normally-
 *  formatted export ("120,000.00", "₹1,250") isn't rejected on formatting
 *  alone. Never applied outside a NUMERIC_FIELD, and never invents a value:
 *  anything that still doesn't parse as a number afterward (a stray percent
 *  sign, a trailing currency code, actual prose) is returned untouched by
 *  parseCellValue, exactly as before this existed, so the backend's own
 *  per-field message explains what's actually wrong. */
function stripNumericFormatting(text: string): string {
  return text.replace(/^[₹$€£¤]\s*/, '').replace(/,/g, '')
}

/** A row needs at least this many cells recognized as known header spellings
 *  before it's trusted as THE header row, rather than an ordinary data row
 *  that happens to contain one header-like word (e.g. a Status column's
 *  own value being the literal string "Status" in some export). Every real
 *  header row in this app's templates has at least this many columns. */
const MIN_HEADER_MATCHES = 2

/** Every header spelling this app recognizes anywhere, across every domain
 *  — canonical names, global aliases, and every domain-scoped override
 *  spelling — used only to locate WHICH row is the header row, before any
 *  domain has necessarily been chosen yet. Which FIELD each of those
 *  spellings resolves to (which is domain-dependent for the two overridden
 *  spellings) is decided afterward, by resolveHeaderField. */
function allRecognizedHeaders(): Set<string> {
  const all = new Set(Object.keys(HEADER_TO_FIELD))
  for (const overrides of Object.values(DOMAIN_HEADER_OVERRIDES)) {
    for (const header of Object.keys(overrides ?? {})) all.add(header)
  }
  return all
}

/** Locates the actual column-header row within a sheet that may carry a
 *  report title, an explanatory note, and/or blank rows above the real
 *  table — rather than assuming row 1 always is the header, which silently
 *  turned every row of a realistically-formatted export into unrecognized
 *  data (see docs/superpowers/analysis for the 2026-09 write-up this fixed).
 *  Scores every row by how many of its cells are an exact, known header
 *  spelling and returns the single best-scoring row, provided it clears
 *  MIN_HEADER_MATCHES. A title/note row scores 0 (it's prose, not a list of
 *  column names) and a stray reference/legend list placed elsewhere in the
 *  sheet would need to repeat that many literal header words verbatim to
 *  outscore the real header — in practice this never happens, so the first
 *  (and only) row to clear the floor is reliably the real one. Returns
 *  `null` when no row clears the floor at all — a genuinely unrecognizable
 *  sheet, exactly the case that already needs to reach the caller as
 *  "unrecognized"/zero rows rather than guessing. */
function findHeaderRow(aoa: unknown[][], recognized: Set<string>): { index: number; headers: string[] } | null {
  let best: { index: number; headers: string[]; score: number } | null = null
  aoa.forEach((row, index) => {
    const headers = row.map((cell) => String(cell ?? '').trim())
    const score = headers.filter((h) => h !== '' && recognized.has(h)).length
    if (score >= MIN_HEADER_MATCHES && (!best || score > best.score)) {
      best = { index, headers, score }
    }
  })
  return best
}

/** `domain`, when known (the sheet was auto-detected, or the caller already
 *  knows which template it's parsing — e.g. parseWorkbook), resolves the
 *  two domain-scoped override header spellings correctly; omitted for a
 *  sheet still awaiting the admin's own domain choice, which falls back to
 *  each header's single global meaning exactly as before this existed. */
export function rowsFromSheet(worksheet: XLSX.WorkSheet, domain?: SpreadsheetDomainKey): ImportRow[] {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, blankrows: false, defval: '', raw: false })
  const found = findHeaderRow(aoa, allRecognizedHeaders())
  if (!found) return []

  return aoa.slice(found.index + 1).map((dataRow) => {
    const row: ImportRow = {}
    found.headers.forEach((header, colIndex) => {
      if (header === '') return
      const field = resolveHeaderField(domain, header)
      if (!field) return
      const parsed = parseCellValue(field, dataRow[colIndex])
      if (parsed !== undefined) row[field] = parsed
    })
    return row
  })
}

/** Multi-sheet domains submit a `{ sheetKey: rows[] }` dictionary; the keys
 *  are the importer's own internal names, not the human sheet titles. */
export const MULTI_SHEET_KEYS: Partial<Record<SpreadsheetDomainKey, Record<string, string>>> = {
  commercialMastersCatalog: { Verticals: 'verticals', Products: 'products', Modules: 'modules', Features: 'features' },
  commercialMastersFlat: {
    'SKU Categories': 'skuCategories', 'Units of Measure': 'unitsOfMeasure',
    'Product Editions': 'productEditions', 'Billing Types': 'billingTypes', 'Pre-Sales': 'preSales',
  },
  salesRoster: { 'Sales Persons': 'persons', Postings: 'postings' },
}

/** The sheet's real column headers, wherever in the sheet they actually
 *  are — see findHeaderRow. Falls back to the first non-blank row (the old
 *  behavior) only when no row anywhere recognizes enough known headers to
 *  qualify; that fallback exists purely so a genuinely unrecognizable sheet
 *  still reports SOME headers for "why didn't this match anything" purposes
 *  instead of an empty array indistinguishable from a blank sheet. */
export function sheetHeaders(worksheet: XLSX.WorkSheet): string[] {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, blankrows: false, defval: '', raw: false })
  const found = findHeaderRow(aoa, allRecognizedHeaders())
  if (found) return found.headers.filter((h) => h !== '')
  const [firstRow] = aoa
  return (firstRow ?? []).map((h) => String(h ?? '').trim()).filter((h) => h !== '')
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

  // Recognizes an alias header exactly like a canonical one: a domain's
  // canonical columns name its required FIELDS; expectedHeaders is every
  // header spelling (canonical or alias) that maps to one of those fields,
  // so a sheet using only alias headers is still correctly recognized.
  const requiredFields = new Set(TEMPLATE_COLUMNS[domain].flatMap((s) => s.columns).map((h) => HEADER_TO_FIELD[h]).filter(Boolean))
  const expectedHeaders = new Set([...requiredFields].flatMap((f) => headersForField(domain, f)))
  const foundAnyExpectedHeader = workbook.SheetNames.some((name) =>
    sheetHeaders(workbook.Sheets[name]).some((h) => expectedHeaders.has(h)),
  )
  if (!foundAnyExpectedHeader) {
    throw new UnrecognizedWorkbookError(`No ${domain} columns found in this workbook.`)
  }

  if (!sheetKeys) {
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
    return firstSheet ? rowsFromSheet(firstSheet, domain).filter((r) => !isBlank(r)) : []
  }

  const result: Record<string, ImportRow[]> = {}
  for (const [sheetTitle, key] of Object.entries(sheetKeys)) {
    const worksheet = workbook.Sheets[sheetTitle]
    result[key] = worksheet ? rowsFromSheet(worksheet, domain).filter((r) => !isBlank(r)) : []
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
