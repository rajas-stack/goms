// A realistic-looking admin-import session for manual smoke testing: instead
// of one clean file per app domain, this mimics what actually lands on an
// admin's desk — separate exports from separate systems (an HRMS export, a
// CRM roster export, a finance pricing workbook, a product-team catalog doc),
// each with that system's own sheet names, header vocabulary, column order,
// and a few extra columns this importer doesn't care about. Contrast with
// build-fixtures.ts's QAIMP-* files, which exist purely to drive the
// Playwright lineage-matrix assertions mechanically.
//
// Real spreadsheet touches: bold header row, sensible column widths, ~10+
// rows per sheet (not 2), "Yes"/"No" booleans instead of true/false, and a
// couple of extra columns (Cost Center, Territory, Approved By, Product
// Manager) that don't map to any importer field and must be silently
// ignored — a real HR/CRM/Finance export always carries columns the
// receiving system doesn't use. Nothing here is real company/personal data.
import * as XLSX from 'xlsx'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT_DIR = join(import.meta.dirname, 'out', 'realistic')

function headerStyle() {
  return { font: { bold: true }, fill: { fgColor: { rgb: 'F2F2F2' } } }
}

/** Builds one worksheet with a bold header row and auto-sized columns —
 *  wrapped defensively since cell-style writing depends on the SheetJS
 *  build in use; a plain unstyled sheet is a fine fallback and must never
 *  block fixture generation. */
function sheetFromAoa(aoa: unknown[][]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const headerRow = aoa[0] ?? []
  try {
    headerRow.forEach((_, col) => {
      const ref = XLSX.utils.encode_cell({ r: 0, c: col })
      if (ws[ref]) ws[ref].s = headerStyle()
    })
  } catch {
    // Style writing unsupported in this build — value data is unaffected.
  }
  ws['!cols'] = headerRow.map((h) => ({ wch: Math.max(12, String(h).length + 4) }))
  return ws
}

function writeWorkbook(path: string, sheets: Record<string, unknown[][]>) {
  const workbook = XLSX.utils.book_new()
  for (const [title, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, sheetFromAoa(aoa), title)
  }
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellStyles: true }))
}

mkdirSync(OUT_DIR, { recursive: true })

const YES = 'Yes'
const NO = 'No'

// --- File 1: HRMS export — its own "Org Chart" / "Employee Master" tabs
// and vocabulary, not the app's canonical sheet/column names. ---
writeWorkbook(join(OUT_DIR, 'Employee_Master_Export_Aug2026.xlsx'), {
  'Org Chart': [
    ['Type', 'Name', 'Node Code', 'Parent', 'Status'],
    ['division', 'Sales & Marketing', 'DIV-SM', '', 'active'],
    ['division', 'Engineering', 'DIV-ENG', '', 'active'],
    ['division', 'Business Operations', 'DIV-OPS', '', 'active'],
    ['department', 'Enterprise Sales', 'DEPT-ES', 'DIV-SM', 'active'],
    ['department', 'Government Sales', 'DEPT-GS', 'DIV-SM', 'active'],
    ['department', 'Channel Sales', 'DEPT-CS', 'DIV-SM', 'active'],
    ['department', 'Product Engineering', 'DEPT-PE', 'DIV-ENG', 'active'],
    ['department', 'Quality Assurance', 'DEPT-QA', 'DIV-ENG', 'active'],
    ['department', 'Customer Operations', 'DEPT-OPS', 'DIV-OPS', 'active'],
    ['branch', 'Mumbai Branch Office', 'BR-MUM', '', 'active'],
  ],
  'Employee Master': [
    ['Emp Code', 'Employee Name', 'Job Title', 'Email', 'Phone', 'Department Code', 'Reporting Manager Code', 'Is Vacant', 'Employee Status', 'Dept Head Of', 'Cost Center', 'Grade', 'Base Location'],
    ['EMP-1001', 'Rohan Mehta', 'VP - Sales & Marketing', 'rohan.mehta@gomscorp.example', '+91 98200 10001', 'DIV-SM', '', NO, 'active', '', 'CC-100', 'E1', 'Mumbai'],
    ['EMP-1002', 'Ananya Iyer', 'Manager - Enterprise Sales', 'ananya.iyer@gomscorp.example', '+91 98200 10002', 'DEPT-ES', 'EMP-1001', NO, 'active', 'DEPT-ES', 'CC-101', 'M2', 'Mumbai'],
    ['EMP-1003', 'Vikram Shah', 'Sales Executive', 'vikram.shah@gomscorp.example', '+91 98200 10003', 'DEPT-ES', 'EMP-1002', NO, 'active', '', 'CC-101', 'E3', 'Mumbai'],
    ['EMP-1004', '', 'Sales Executive', '', '', 'DEPT-ES', 'EMP-1002', YES, 'active', '', 'CC-101', 'E3', 'Mumbai'],
    ['EMP-1005', 'Priya Nair', 'Manager - Government Sales', 'priya.nair@gomscorp.example', '+91 98200 10005', 'DEPT-GS', 'EMP-1001', NO, 'active', 'DEPT-GS', 'CC-102', 'M2', 'Delhi'],
    ['EMP-1006', 'Karan Desai', 'Sales Executive', 'karan.desai@gomscorp.example', '+91 98200 10006', 'DEPT-GS', 'EMP-1005', NO, 'active', '', 'CC-102', 'E3', 'Delhi'],
    ['EMP-1007', 'Divya Menon', 'Manager - Channel Sales', 'divya.menon@gomscorp.example', '+91 98200 10007', 'DEPT-CS', 'EMP-1001', NO, 'active', 'DEPT-CS', 'CC-103', 'M2', 'Bengaluru'],
    ['EMP-1008', '', 'Channel Partner Executive', '', '', 'DEPT-CS', 'EMP-1007', YES, 'active', '', 'CC-103', 'E3', 'Bengaluru'],
    ['EMP-1009', 'Neha Kulkarni', 'VP - Engineering', 'neha.kulkarni@gomscorp.example', '+91 98200 10009', 'DIV-ENG', '', NO, 'active', '', 'CC-200', 'E1', 'Pune'],
    ['EMP-1010', 'Arjun Reddy', 'Engineering Manager', 'arjun.reddy@gomscorp.example', '+91 98200 10010', 'DEPT-PE', 'EMP-1009', NO, 'active', 'DEPT-PE', 'CC-201', 'M2', 'Pune'],
    ['EMP-1011', 'Sneha Joshi', 'Software Engineer', 'sneha.joshi@gomscorp.example', '+91 98200 10011', 'DEPT-PE', 'EMP-1010', NO, 'active', '', 'CC-201', 'E4', 'Pune'],
    ['EMP-1012', 'Rahul Verma', 'QA Lead', 'rahul.verma@gomscorp.example', '+91 98200 10012', 'DEPT-QA', 'EMP-1009', NO, 'active', 'DEPT-QA', 'CC-202', 'M3', 'Pune'],
    ['EMP-1013', 'Kavita Rao', 'VP - Business Operations', 'kavita.rao@gomscorp.example', '+91 98200 10013', 'DIV-OPS', '', NO, 'active', '', 'CC-300', 'E1', 'Mumbai'],
    ['EMP-1014', 'Manoj Kumar', 'Customer Support Lead', 'manoj.kumar@gomscorp.example', '+91 98200 10014', 'DEPT-OPS', 'EMP-1013', NO, 'active', 'DEPT-OPS', 'CC-301', 'M3', 'Mumbai'],
  ],
})

// --- File 2: CRM export — the sales team roster as the CRM itself would
// export it (deliberately independent of the HRMS employee list). ---
writeWorkbook(join(OUT_DIR, 'CRM_Sales_Roster_Export.xlsx'), {
  'Sales Reps': [
    ['Work Email', 'Name', 'Personal Email', 'Mobile', 'Alt Mobile', 'Joined On', 'Status', 'Territory'],
    ['ananya.iyer@gomscorp.example', 'Ananya Iyer', '', '+91 98200 10002', '', '2023-04-10', 'active', 'West'],
    ['vikram.shah@gomscorp.example', 'Vikram Shah', '', '+91 98200 10003', '', '2024-01-15', 'active', 'West'],
    ['priya.nair@gomscorp.example', 'Priya Nair', '', '+91 98200 10005', '', '2022-11-01', 'active', 'North'],
    ['karan.desai@gomscorp.example', 'Karan Desai', '', '+91 98200 10006', '', '2024-06-01', 'active', 'North'],
    ['divya.menon@gomscorp.example', 'Divya Menon', '', '+91 98200 10007', '', '2024-03-01', 'active', 'South'],
    ['ritesh.pillai@gomscorp.example', 'Ritesh Pillai', '', '+91 98200 10015', '', '2024-09-01', 'active', 'South'],
    ['fatima.sheikh@gomscorp.example', 'Fatima Sheikh', '', '+91 98200 10016', '', '2021-06-01', 'active', 'National'],
  ],
  'Posting History': [
    ['Person Email', 'Designation', 'Tier Key', 'Reporting Manager Email', 'Office Name', 'Start Date', 'Reason', 'Approved By'],
    ['ananya.iyer@gomscorp.example', 'General Manager', 'gm', '', 'Mumbai', '2023-04-10', 'initial posting', 'Rohan Mehta'],
    ['vikram.shah@gomscorp.example', 'Area Manager', 'accountManager', 'ananya.iyer@gomscorp.example', 'Mumbai', '2024-01-15', 'initial posting', 'Ananya Iyer'],
    ['priya.nair@gomscorp.example', 'General Manager', 'gm', '', 'Delhi', '2022-11-01', 'initial posting', 'Rohan Mehta'],
    ['karan.desai@gomscorp.example', 'Regional Manager', 'rm', 'priya.nair@gomscorp.example', 'Delhi', '2024-06-01', 'initial posting', 'Priya Nair'],
    ['divya.menon@gomscorp.example', 'Regional Manager', 'rm', 'ananya.iyer@gomscorp.example', 'Bengaluru', '2024-03-01', 'initial posting', 'Ananya Iyer'],
    ['ritesh.pillai@gomscorp.example', 'Channel Partner Manager', 'accountManager', 'divya.menon@gomscorp.example', 'Bengaluru', '2024-09-01', 'initial posting', 'Divya Menon'],
    ['fatima.sheikh@gomscorp.example', 'National Sales Head', 'salesHead', '', 'Delhi', '2021-06-01', 'initial posting', 'Rohan Mehta'],
  ],
})

// --- File 3: reference-data workbook, built off the app's own downloadable
// template (a real ops/finance team very often just fills in the vendor's
// template for standardized lookup lists rather than reshaping it) — same
// sheet/column names as the app expects, just more rows than a bare
// 2-row dev fixture. ---
writeWorkbook(join(OUT_DIR, 'GOMS_Reference_Data_Template.xlsx'), {
  'SKU Categories': [
    ['Code', 'Name', 'Description', 'Active', 'Display Order'],
    ['CAT-SW', 'Software Licenses', 'Subscription and perpetual software SKUs', YES, 0],
    ['CAT-SVC', 'Professional Services', 'Implementation and onboarding services', YES, 1],
    ['CAT-HW', 'Hardware', 'On-premise appliances and devices', YES, 2],
    ['CAT-SUP', 'Support & Maintenance', 'Annual support and maintenance contracts', YES, 3],
  ],
  'Units of Measure': [
    ['Code', 'Name', 'Description', 'Active', 'Display Order'],
    ['UOM-USER', 'Per User', 'Priced per named user', YES, 0],
    ['UOM-MO', 'Per Month', 'Priced per calendar month', YES, 1],
    ['UOM-YR', 'Per Year', 'Priced per annual term', YES, 2],
    ['UOM-UNIT', 'Per Unit', 'Priced per physical unit', YES, 3],
  ],
  'Product Editions': [
    ['Code', 'Name', 'Description', 'Active', 'Display Order'],
    ['STD', 'Standard', 'Standard feature set', YES, 0],
    ['ENT', 'Enterprise', 'Full feature set with premium support', YES, 1],
    ['PRO', 'Professional', 'Mid-tier feature set', YES, 2],
  ],
  'Billing Types': [
    ['Code', 'Name', 'Description', 'Active', 'Display Order'],
    ['BT-SUB', 'Subscription', 'Recurring billing', YES, 0],
    ['BT-PERP', 'Perpetual', 'One-time license fee', YES, 1],
    ['BT-USG', 'Usage-Based', 'Metered/consumption billing', YES, 2],
  ],
  'Pre-Sales': [
    ['Code', 'Name', 'Description', 'Active', 'Display Order'],
    ['PS-001', 'Solution Architect', 'Technical scoping for enterprise deals', YES, 0],
    ['PS-002', 'Pricing Specialist', 'Deal desk pricing support', YES, 1],
    ['PS-003', 'Bid Manager', 'RFP and tender response coordination', YES, 2],
  ],
  Currencies: [
    ['Code', 'Name', 'Symbol', 'Decimal Places', 'Exchange Rate', 'Is Base Currency', 'Active', 'Display Order'],
    ['INR', 'Indian Rupee', '₹', 2, 1, YES, YES, 0],
    ['USD', 'US Dollar', '$', 2, 83.5, NO, YES, 1],
    ['AED', 'UAE Dirham', 'AED', 2, 22.7, NO, YES, 2],
  ],
  'Tax Classes': [
    ['Code', 'Name', 'Description', 'Rate %', 'Active', 'Display Order'],
    ['GST18', 'GST 18%', 'Standard GST slab for software services', 18, YES, 0],
    ['GST5', 'GST 5%', 'Reduced GST slab', 5, YES, 1],
    ['GST0', 'GST 0% (Exempt)', 'Zero-rated / export supply', 0, YES, 2],
  ],
  'Approval Matrix': [
    ['Code', 'Name', 'Description', 'Min Discount %', 'Max Discount %', 'Approval Level Label', 'Allow Auto Approval', 'Active', 'Display Order'],
    ['APR-L1', 'Level 1 - Sales Manager', 'Discounts up to 10%', 0, 10, 'Sales Manager', YES, YES, 0],
    ['APR-L2', 'Level 2 - VP Sales', 'Discounts 10% to 25%', 10, 25, 'VP Sales', NO, YES, 1],
    ['APR-L3', 'Level 3 - CEO', 'Discounts above 25%, executive sign-off only', 25, 40, 'CEO', NO, YES, 2],
  ],
})

// --- File 4: product team's catalog structure doc — also template-shaped
// (a hierarchy definition genuinely needs the app's own Parent Code
// chaining, so there's little reason for the product team to reinvent it). ---
writeWorkbook(join(OUT_DIR, 'Product_Catalog_2026.xlsx'), {
  Verticals: [
    ['Code', 'Name', 'Description', 'Active', 'Display Order', 'Parent Code'],
    ['VERT-GOV', 'Government', 'State and municipal government customers', YES, 0, ''],
    ['VERT-ENT', 'Enterprise', 'Private-sector enterprise customers', YES, 1, ''],
    ['VERT-EDU', 'Education', 'Higher-education and school customers', YES, 2, ''],
  ],
  Products: [
    ['Code', 'Name', 'Description', 'Active', 'Display Order', 'Parent Code'],
    ['PROD-ERP', 'eGovernance Suite', 'Municipal service delivery platform', YES, 0, 'VERT-GOV'],
    ['PROD-CRM', 'Enterprise CRM', 'Sales and account management platform', YES, 0, 'VERT-ENT'],
    ['PROD-LMS', 'Learning Management Suite', 'Course delivery and enrollment platform', YES, 0, 'VERT-EDU'],
  ],
  Modules: [
    ['Code', 'Name', 'Description', 'Active', 'Display Order', 'Parent Code'],
    ['MOD-CITZ', 'Citizen Services Module', 'Grievance and service-request handling', YES, 0, 'PROD-ERP'],
    ['MOD-SALES', 'Sales Module', 'Opportunity and pipeline management', YES, 0, 'PROD-CRM'],
    ['MOD-COURSE', 'Course Management', 'Course catalog and scheduling', YES, 0, 'PROD-LMS'],
  ],
  Features: [
    ['Code', 'Name', 'Description', 'Active', 'Display Order', 'Parent Code', 'Feature Status'],
    ['FEAT-GRIEV', 'Grievance Redressal', 'Citizen complaint tracking and SLAs', YES, 0, 'MOD-CITZ', 'new'],
    ['FEAT-LEAD', 'Lead Management', 'Lead capture and qualification', YES, 0, 'MOD-SALES', 'existing'],
    ['FEAT-ENROLL', 'Student Enrollment', 'Online enrollment and fee collection', YES, 0, 'MOD-COURSE', 'new'],
  ],
})

// --- File 5: finance's own pricing workbook — its own header vocabulary
// again (Item Code, Category, Feature...), since price lists are almost
// always finance-maintained rather than filled in from the vendor template. ---
writeWorkbook(join(OUT_DIR, 'Price_List_2026.xlsx'), {
  'Price List': [
    [
      'Item Code', 'Name', 'Category', 'Feature', 'Edition', 'UOM', 'Currency',
      'Tax Class', 'Billing Type', 'Active From', 'Active Till', 'Lifecycle Status', 'Is Sellable', 'Display Order',
      'Base Software Cost', 'Implementation Cost/MM', 'Integration Cost', 'Third Party Cost', 'Hardware Cost',
      'Cloud Cost', 'Support Cost', 'Training Cost',
      'Internal Price', 'Floor Price', 'Partner Price', 'Government Price', 'Enterprise Price', 'Corporate Price',
      'List Price', 'Minimum Allowed Price', 'Maximum Discount %', 'Product Manager',
    ],
    [
      'SKU-CITZ-STD', 'Citizen Services - Standard', 'CAT-SW', 'FEAT-GRIEV', 'STD', 'UOM-USER', 'INR',
      'GST18', 'BT-SUB', '2026-01-01', '', 'active', YES, 0,
      2000, 500, 0, 0, 0,
      300, 200, 100,
      5000, 4000, 4500, 4200, 5500, 5200,
      6000, 4000, 20, 'Arjun Reddy',
    ],
    [
      'SKU-CITZ-ENT', 'Citizen Services - Enterprise', 'CAT-SW', 'FEAT-GRIEV', 'ENT', 'UOM-USER', 'INR',
      'GST18', 'BT-SUB', '2026-01-01', '', 'active', YES, 1,
      3000, 700, 200, 0, 0,
      400, 300, 150,
      7500, 6500, 7000, 6800, 8000, 7700,
      9000, 6500, 20, 'Arjun Reddy',
    ],
    [
      'SKU-CRM-ENT', 'Enterprise CRM - Enterprise Edition', 'CAT-SW', 'FEAT-LEAD', 'ENT', 'UOM-USER', 'INR',
      'GST18', 'BT-SUB', '2026-01-01', '', 'active', YES, 2,
      3500, 800, 500, 0, 0,
      600, 400, 200,
      8000, 7000, 7500, 7200, 8500, 8200,
      12000, 7000, 25, 'Sneha Joshi',
    ],
    [
      'SKU-LMS-STD', 'Course Management - Standard', 'CAT-SW', 'FEAT-ENROLL', 'STD', 'UOM-YR', 'USD',
      'GST0', 'BT-SUB', '2026-01-01', '', 'active', YES, 3,
      1500, 400, 0, 0, 0,
      100, 150, 80,
      900, 750, 800, 780, 950, 900,
      1200, 750, 15, 'Rahul Verma',
    ],
    [
      'SKU-SUITE-BUNDLE', 'GOMS Suite Bundle', 'CAT-SW', 'FEAT-GRIEV', 'STD', 'UOM-USER', 'INR',
      'GST18', 'BT-SUB', '2026-01-01', '', 'active', YES, 4,
      0, 0, 0, 0, 0,
      0, 0, 0,
      10000, 9000, 9500, 9200, 10500, 10200,
      15000, 9000, 15, 'Arjun Reddy',
    ],
  ],
  'Bundle Composition': [
    ['Parent SKU Code', 'Component SKU Code', 'Mandatory', 'Quantity', 'Notes'],
    ['SKU-SUITE-BUNDLE', 'SKU-CITZ-STD', YES, 1, 'Core citizen services module'],
    ['SKU-SUITE-BUNDLE', 'SKU-CRM-ENT', NO, 1, 'Optional CRM add-on'],
  ],
})

console.log('Realistic fixtures written to', OUT_DIR)
