import { describe, expect, it } from 'vitest'
import { BID_IMPORT_KEEP_AS_HISTORY, deriveOpportunityType, normalizeBidMobile, parseImportAmount, parseImportDate, validateBidTransfer, type BidImportTable, type BidTransferContext } from './bidTransfer.js'

const context: BidTransferContext = {
  existing: [{ opportunityName: 'Live bid', gemTenderId: 'GEM/1' }],
  people: [
    { id: 'sales-1', name: 'Sales Owner', email: 'owner@example.com', mobile: '9876543210', team: 'sales' },
    { id: 'sales-2', name: 'Ashish Desai', email: 'ashish@example.com', team: 'sales' },
    { id: 'pre-1', name: 'Pre Owner', team: 'preSales' },
    { id: 'bid-1', name: 'Pawan Shah', team: 'bid' },
  ],
  states: [{ id: '24', name: 'Gujarat' }, { id: '27', name: 'Maharashtra' }], departments: [{ id: 'dept-1', name: 'Client', stateCode: 24 }],
  customFields: [{ id: 'phone', key: 'mobile', name: 'Mobile Number', dataType: 'phone' }],
}
const check = (headers: string[], ...rows: BidImportTable['rows']) => validateBidTransfer({ headers, rows }, context)

/** Header row of the historical bid tracker exactly as users export it. */
const HISTORICAL = ['#', 'Opportunity Name', 'RFP Description', 'SBU', 'Hot / Cold', 'Scope', 'Tender Value (In Cr, Excluding Tax)',
  'RFP Published Date (DD/MM/YYYY)', 'RFP Received Date (DD/MM/YYYY)', 'Query Submission (As per RFP)', 'Pre Bid Meeting Date',
  'PB Response Published Date', 'Due Date of submission', 'Current Date of submission', 'PQ Compliance', 'TQ Compliance Subjective, Objectivve',
  'Pre Cxo (Yes/No)', 'Final CxO (Yes/No)', 'Bid Team Work Status (PQ-TQ) & Eligibility as OEM %', 'Pre-sales Technical Status %',
  'Commerical Working Status %', 'Bid Approval Received (Yes/No-Go /Under Approval)', 'Submission Type (Online / Offline / Both)',
  'Evaluation Type (LCBS / QCBS)', 'Tender Fee', 'Tender Fee in the Form Of', 'Tender Fee Paid (Yes/No/NA)', 'Tender EMD', 'Tender EMD in the Form Of',
  'RTM', 'HP / GS', 'Bid Team Owner', 'Bid Team Lead', 'Presales Owner', 'Presales Lead', 'Geo Sales Owner', 'State', 'Zone', 'Vertical Owner',
  'BU owner', 'Tender Stage', 'Tender Status', 'EMD refund RECEIVED (Yes/ No)', 'Participant List/ Reason of Bid Lost or not participating',
  'Qtr - RFP Received', 'Qtr - RFP Submitted', 'Status from Today', 'Financial Bid Opening Date', 'LOI Date', 'LOA / WO Date', 'Agreement Date',
  'Tender Folder Link', 'CRM Link', 'Stage 1', 'Go/No Go', 'CXO', 'Tender ID', 'Tender Website']

describe('historical bid tracker import', () => {
  it('imports the demo historical row with zero blocking errors and nothing dropped', () => {
    const row: Record<string, string> = {
      '#': '1', 'Opportunity Name': 'Maha IT CM Dashboard EOI', 'RFP Description': 'Expression of Interest (EoI) for Inviting Proposals for Development of Hon. Chief Minister\'s Dashboard',
      SBU: 'NGIS-Ops', Scope: 'Dashboard development', 'RFP Published Date (DD/MM/YYYY)': '09-01-2026', 'RFP Received Date (DD/MM/YYYY)': '10-01-2026',
      'Pre Bid Meeting Date': 'NA', 'Due Date of submission': '29-01-2026', 'Current Date of submission': '05-02-2026',
      'Pre Cxo (Yes/No)': 'Yes', 'Final CxO (Yes/No)': 'No', 'Bid Approval Received (Yes/No-Go /Under Approval)': 'Go',
      'Submission Type (Online / Offline / Both)': 'Online', 'Tender Fee': '10,000', 'Tender Fee in the Form Of': 'Online', 'Tender Fee Paid (Yes/No/NA)': 'No',
      'Tender EMD': 'NA', 'Tender EMD in the Form Of': 'NA', RTM: 'Sold', 'Bid Team Owner': 'Pawan', 'Bid Team Lead': 'Pawan Shah', 'Presales Owner': 'Sushma',
      'Presales Lead': 'Ashish Desai', 'Geo Sales Owner': 'Sanjay', State: 'Maharashtra', Zone: 'West', 'Vertical Owner': 'Ashish Desai', 'BU owner': 'Ashish Desai',
      'Tender Stage': 'Submitted', 'Tender Status': 'Under Evaluation', 'EMD refund RECEIVED (Yes/ No)': 'NA',
      'Participant List/ Reason of Bid Lost or not participating': '18 Participants: IBM, Accenture …', 'Qtr - RFP Received': 'FY-25', 'Qtr - RFP Submitted': 'FY-25',
      'Financial Bid Opening Date': '30-01-2026',
    }
    const p = check(HISTORICAL, HISTORICAL.map(h => row[h] ?? ''))
    expect(p.issues).toEqual([])
    expect(p.valid).toBe(true)
    const { values, legacy } = p.prepared[0]
    expect(values).toMatchObject({
      opportunityName: 'Maha IT CM Dashboard EOI', opportunityType: 'EOI', publishDate: '2026-01-09', submissionDate: '2026-02-05',
      'general:receivingDate': '2026-01-10', 'general:bidDeadline': '2026-01-29', 'general:submissionMode': 'online',
      stateCode: 27, stageKey: 'submitted', buSalesPersonId: 'sales-2', bidTeamMemberId: 'bid-1',
      vertical: 'NGIS-Ops',
    })
    // "NA" is blank, not a value; an unmatched person is kept as history, never invented.
    expect(values['general:preBidMeeting']).toBeUndefined()
    expect(values.emdAmount).toBeUndefined()
    expect(values.geoSalesPersonId).toBeUndefined()
    expect(legacy.SBU).toBeUndefined()
    expect(legacy).toMatchObject({ Zone: 'West', RTM: 'Sold', 'Geo Sales Owner': 'Sanjay', 'BU owner': 'Ashish Desai', 'Tender Status': 'Under Evaluation', 'Financial Bid Opening Date': '30-01-2026', 'Qtr - RFP Received': 'FY-25' })
    expect(legacy['#']).toBeUndefined()
    expect(p.warnings!.some(w => /no app field/.test(w.message))).toBe(true)
  })
  it.each(HISTORICAL)('never rejects the historical header "%s"', header => {
    const p = check(header === 'Opportunity Name' ? [header] : ['Opportunity Name', header], header === 'Opportunity Name' ? ['A'] : ['A', 'some value'])
    expect(p.issues).toEqual([])
  })
})

describe('format recognition', () => {
  it.each([
    ['19/10/2026', '2026-10-19'], ['19-10-2026', '2026-10-19'], ['19.10.2026', '2026-10-19'], ['9/1/26', '2026-01-09'], ['2026-10-19', '2026-10-19'],
    ['9 Jan 2026', '2026-01-09'], ['09-Jan-26', '2026-01-09'], ['Jan 9, 2026', '2026-01-09'], ['5th September 2026', '2026-09-05'],
    ['19/10/2026 15:30', '2026-10-19T15:30'], ['19/10/2026 3:30 PM', '2026-10-19T15:30'], ['2026-10-19T23:59:59', '2026-10-19T23:59'], ['46031', '2026-01-09'],
  ])('reads date "%s"', (raw, iso) => expect(parseImportDate(raw)).toBe(iso))
  it.each(['31/02/2026', '2026-10-19T24:00', '12:60', 'soon', '1/13/2026'])('refuses non-dates "%s"', raw => expect(parseImportDate(raw)).toBeNull())
  it.each([
    ['10', 'cr', '10'], ['₹ 11 Cr', 'cr', '11'], ['1150 lakh', 'cr', '11.5'], ['Rs. 1,10,00,000', 'cr', '1.1'],
    ['10,000', 'rupee', '10000'], ['2.5 lakh', 'rupee', '250000'], ['₹5,000/-', 'rupee', '5000'], ['1 Cr', 'rupee', '10000000'],
  ] as const)('reads amount "%s" in %s', (raw, unit, out) => expect(parseImportAmount(raw, unit)).toBe(out))
  it.each([['Request for Proposal for SI', 'RFP'], ['EoI for consultants', 'EOI'], ['NIT No. 4', 'Tender'], ['Supply of buses', '']])('derives type from "%s"', (text, type) => expect(deriveOpportunityType(text)).toBe(type))
  it.each(['+91 98765 43210', '00919876543210', '919876543210', '09876543210', '9876543210'])('normalizes only explicit supported mobile formatting: %s', input => expect(normalizeBidMobile(input)).toBe('9876543210'))
  it.each(['1234567890', '1119876543210', '+449876543210', '987654321', '98765432101', '98letters76543210'])('rejects unknown mobile conditions: %s', input => expect(normalizeBidMobile(input)).toBeNull())
})

describe('linking and soft handling', () => {
  it('accepts department-agnostic bids and normalizes known fields', () => {
    const p = check(['Opportunity Name', 'RFP Published Date (DD/MM/YYYY)', 'Geo Sales Owner', 'State', 'Mobile Number'], [' New bid ', '19/10/2026', '+91 98765 43210', 'Gujarat', '09876543210'])
    expect(p.issues).toEqual([])
    expect(p.prepared[0].values).toMatchObject({ opportunityName: 'New bid', publishDate: '2026-10-19', geoSalesPersonId: 'sales-1', stateCode: 24, 'custom:mobile': '9876543210' })
    expect(p.prepared[0].values.departmentId).toBeUndefined()
  })
  it('links a unique first name and flags it for review', () => {
    const p = check(['Opportunity Name', 'Vertical Owner'], ['A', 'Ashish'])
    expect(p.prepared[0].values.buSalesPersonId).toBe('sales-2')
    expect(p.warnings!.some(w => /by first name/.test(w.message))).toBe(true)
  })
  it.each([
    [['Opportunity Name', 'Unknown column'], ['New', 'value'], 'Unknown column'],
    [['Opportunity Name', 'Zone'], ['New', 'unmapped value'], 'Zone'],
    [['Opportunity Name', 'Geo Sales Owner'], ['New', 'Pre Owner'], 'Geo Sales Owner'],
    [['Opportunity Name', 'Tender Stage'], ['New', 'Awaiting LOI'], 'Tender Stage'],
    [['Opportunity Name', 'PQ Compliance'], ['New', 'maybe'], 'PQ Compliance'],
    [['Opportunity Name', 'RFP Published Date'], ['New', '31/02/2026'], 'RFP Published Date'],
    [['Opportunity Name', 'Tender Value'], ['New', 'USD 100'], 'Tender Value'],
  ])('keeps unlinkable value %# as history instead of rejecting', (headers, row, key) => {
    const p = check(headers as string[], row as string[])
    expect(p.valid).toBe(true)
    expect(p.prepared[0].legacy[key as string]).toBe((row as string[])[1])
  })
  it('imports Go before Submitted as Pending and keeps the historical Go', () => {
    const p = check(['Opportunity Name', 'Go/No Go'], ['New', 'Go'])
    expect(p.prepared[0].values.decision).toBe('pending')
    expect(p.prepared[0].legacy['Decision (historical)']).toBe('Go')
  })
  it('maps historical compliance and stage wording', () => {
    const p = check(['Opportunity Name', 'PQ Compliance', 'Tender Stage'], ['New', 'Yes', 'Under Evaluation'])
    expect(p.prepared[0].values).toMatchObject({ 'general:pqCompliance': 'complied', stageKey: 'submitted' })
  })
})

describe('still blocking', () => {
  it.each([
    [['Opportunity Name'], ['Live bid']],
    [['Opportunity Name', 'Tender ID'], ['New bid', 'gem/1']],
    [['Opportunity Name', 'Opportunity Name'], ['One', 'Two']],
    [['Tender ID'], ['T1']],
    [['Opportunity Name', 'Scope'], ['New', '=HYPERLINK("http://x")']],
  ])('rejects existing bids, duplicate headers, a missing name and formula text %#', (headers, row) => {
    const p = check(headers, row)
    expect(p.valid).toBe(false); expect(p.prepared).toEqual([])
  })
  it('catches duplicates within a file and never mutates reference data', () => {
    const before = structuredClone(context)
    expect(check(['Opportunity Name'], ['Same'], [' same ']).valid).toBe(false)
    expect(context).toEqual(before)
  })
  it('treats spreadsheet error cells as blank with a note', () => {
    const p = validateBidTransfer({ headers: ['Opportunity Name', 'Scope'], rows: [['New bid', '#N/A']], cellIssues: [{ row: 2, column: 1, message: 'Spreadsheet error cell.' }] }, context)
    expect(p.valid).toBe(true)
    expect(p.prepared[0].values['general:scopeOfWork']).toBeUndefined()
    expect(p.warnings).toHaveLength(1)
  })
})

describe('import wizard column mapping', () => {
  const map = (mapping: (string | null)[], headers: string[], ...rows: BidImportTable['rows']) => validateBidTransfer({ headers, rows, mapping }, context)

  it('re-points a column the user chose to another app field', () => {
    const result = map([null, 'assignmentName'], ['Opportunity Name', 'Notes'], ['New bid', 'Smart city RFP'])
    expect(result.valid).toBe(true)
    expect(result.prepared[0].values.assignmentName).toBe('Smart city RFP')
    expect(result.prepared[0].legacy.Notes).toBeUndefined()
  })

  it('skips a column entirely and reports it', () => {
    const result = map([null, ''], ['Opportunity Name', 'Zone'], ['New bid', 'West'])
    expect(result.valid).toBe(true)
    expect(result.prepared[0].legacy.Zone).toBeUndefined()
    expect(result.warnings?.some(w => w.column === 1 && /skipped/.test(w.message))).toBe(true)
  })

  it('keeps a matched column as history only when asked', () => {
    const result = map([null, BID_IMPORT_KEEP_AS_HISTORY], ['Opportunity Name', 'Tender ID'], ['New bid', 'GEM/99'])
    expect(result.valid).toBe(true)
    expect(result.prepared[0].values.gemTenderId).toBeUndefined()
    expect(result.prepared[0].legacy['Tender ID']).toBe('GEM/99')
  })

  it('rejects a mapping to a field that does not exist', () => {
    expect(map([null, 'nope'], ['Opportunity Name', 'X'], ['New bid', 'y']).valid).toBe(false)
  })

  it('still blocks a duplicate Tender ID mapped from a renamed column', () => {
    expect(map([null, 'gemTenderId'], ['Opportunity Name', 'Ref'], ['New bid', 'GEM/1']).valid).toBe(false)
  })

  it('uses the first of two columns mapped to one field and keeps the other as history', () => {
    const result = map([null, 'assignmentName', 'assignmentName'], ['Opportunity Name', 'A', 'B'], ['New bid', 'first', 'second'])
    expect(result.prepared[0].values.assignmentName).toBe('first')
    expect(result.prepared[0].legacy.B).toBe('second')
  })

  it('unmapped tables behave exactly as before', () => {
    expect(map([], ['Opportunity Name'], ['New bid']).valid).toBe(true)
  })
})

describe('existing-bid decision gate', () => {
  const ctx: BidTransferContext = { ...context, existing: [{ id: 'opp-1', bidCode: 'BID-1', opportunityName: 'Live bid', gemTenderId: 'GEM/1', current: { opportunityName: 'Live bid', assignmentName: 'Old' } }] }
  const run = (rowActions: Record<string, 'skip' | 'add' | 'override'> | undefined, ...rows: BidImportTable['rows']) =>
    validateBidTransfer({ headers: ['Opportunity Name', 'RFP Description'], rows, rowActions }, ctx)

  it('blocks a match until a decision is made and lists it with a diff', () => {
    const result = run(undefined, ['Live bid', 'New wording'])
    expect(result.valid).toBe(false)
    expect(result.matches?.[0]).toMatchObject({ row: 2, existingId: 'opp-1', existingCode: 'BID-1' })
    expect(result.matches?.[0].diffs).toContainEqual(expect.objectContaining({ field: 'assignmentName', before: 'Old', after: 'New wording' }))
  })
  it('skip drops the row', () => {
    const result = run({ 2: 'skip' }, ['Live bid', 'x'], ['Fresh bid', 'y'])
    expect(result.valid).toBe(true)
    expect(result.rowCount).toBe(1)
    expect(result.skipped).toEqual([2])
  })
  it('add creates a new record', () => {
    const result = run({ 2: 'add' }, ['Live bid', 'x'])
    expect(result.valid).toBe(true)
    expect(result.prepared[0]).toMatchObject({ mode: 'add' })
  })
  it('override targets the existing record', () => {
    const result = run({ 2: 'override' }, ['Live bid', 'x'])
    expect(result.prepared[0]).toMatchObject({ mode: 'override', targetId: 'opp-1' })
  })
  it('a repeat inside the file needs Skip or Add, not Override', () => {
    expect(run(undefined, ['Fresh', 'a'], ['Fresh', 'b']).valid).toBe(false)
    expect(run({ 3: 'override' }, ['Fresh', 'a'], ['Fresh', 'b']).valid).toBe(false)
    expect(run({ 3: 'add' }, ['Fresh', 'a'], ['Fresh', 'b']).valid).toBe(true)
  })
})
