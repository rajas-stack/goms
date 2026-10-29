import { describe, expect, it } from 'vitest'
import {
  attachmentFileName, billCoverage, billState, claimTotal, emptyClaim, orderedRows, ownVehicleAmount, rateOf, recode, returnTrip, routeText, setStatus,
  type Attachment, type Expense,
} from './model'
import { claimSheetRows, SHEET_COLUMNS } from './exportFiles'
import { parseDraft } from './ExpenseForm'

let n = 0
const expense = (over: Partial<Expense>): Expense => ({
  id: `e${++n}`, trip: 1, date: '2026-09-07', project: '0-000104 (Sales Internal Cost Project)', particulars: 'Home to Mumbai T2',
  mode: 'Cab', kms: null, amount: 100, remarks: '', attachments: [], createdAt: `2026-09-01T00:00:0${n % 10}Z`, ...over,
})
const attachment = (over: Partial<Attachment> = {}): Attachment => ({
  id: `a${++n}`, code: '', originalName: 'bill.PDF', mimeType: 'application/pdf', size: 10, state: 'saved', driveId: 'd1', ...over,
})

describe('reimbursement claim model', () => {
  it('orders rows by trip then date and numbers records within each trip', () => {
    const claim = { ...emptyClaim('2026-09'), expenses: [
      expense({ trip: 2, date: '2026-09-09', particulars: 'b' }),
      expense({ trip: 1, date: '2026-09-01', particulars: 'a' }),
      expense({ trip: 2, date: '2026-09-07', particulars: 'c' }),
    ] }
    expect(orderedRows(claim).map((r) => [r.expense.particulars, r.record, r.code])).toEqual([
      ['a', 1, 'RB-202609-T01-R01'], ['c', 1, 'RB-202609-T02-R01'], ['b', 2, 'RB-202609-T02-R02'],
    ])
  })

  it('recodes attachments after a row moves and reports saved files to rename', () => {
    const late = expense({ trip: 1, date: '2026-09-09', attachments: [attachment({ code: 'RB-202609-T01-R01-A1' }), attachment({ state: 'pending', code: 'old' })] })
    const { claim, renamed } = recode({ ...emptyClaim('2026-09'), expenses: [late, expense({ trip: 1, date: '2026-09-02' })] })
    expect(claim.expenses[0].attachments.map((a) => a.code)).toEqual(['RB-202609-T01-R02-A1', 'RB-202609-T01-R02-A2'])
    expect(renamed.map((a) => a.code)).toEqual(['RB-202609-T01-R02-A1'])
  })

  it('names Drive files by code with the original extension', () => {
    expect(attachmentFileName('RB-202609-T01-R01-A1', 'IMG 2026.JPEG')).toBe('RB-202609-T01-R01-A1.jpeg')
    expect(attachmentFileName('X', 'noext')).toBe('X')
  })

  it('derives rate, bills (No until attached), totals and coverage', () => {
    const cab = expense({ kms: 9, amount: 600, attachments: [attachment()] })
    const stay = expense({ mode: 'NA', amount: 4000.5 })
    const claim = { ...emptyClaim('2026-09'), expenses: [cab, stay] }
    expect(rateOf(cab)).toBe(66.67)
    expect(rateOf(stay)).toBeNull()
    expect([billState(cab), billState(stay)]).toEqual(['Yes', 'No'])
    expect(claimTotal(claim)).toBe(4600.5)
    expect(billCoverage(claim)).toEqual({ covered: 1, needed: 2 })
  })

  it('pays own vehicle at 8 rupees per km and joins a route with its stops', () => {
    expect(ownVehicleAmount(37.41)).toBe(299.28)
    expect(routeText([{ name: 'Home' }, { name: ' Sachivalaya ' }, { name: 'Office' }])).toBe('Home to Sachivalaya to Office')
  })

  it('stamps status dates going forward and clears later ones going back', () => {
    let claim = setStatus(emptyClaim('2026-09'), 'submitted', '2026-10-01')
    claim = setStatus(claim, 'hod', '2026-10-03')
    expect(claim.statusDates).toEqual({ submitted: '2026-10-01', hod: '2026-10-03' })
    expect(setStatus(claim, 'collecting', '2026-10-04')).toMatchObject({ status: 'collecting', statusDates: {} })
  })

  it('swaps the ends of a journey for the return trip', () => {
    expect(returnTrip('Hotel to Janpath Office')).toBe('Janpath Office to Hotel')
    expect(returnTrip('Printouts')).toBe('Printouts')
  })

  it('exports rows in the claim-sheet schema', () => {
    const claim = { ...emptyClaim('2026-09'), expenses: [expense({ kms: 8.37, amount: 267.71, remarks: 'uber' }), expense({ trip: 0, mode: 'NA', amount: 4000, date: '2026-09-01', particulars: 'Own stay' })] }
    expect(SHEET_COLUMNS).toEqual(['Trip No.', 'Record no', 'Date', 'Network / WBS / Project Name', 'Particulars', 'Mode', 'Kms.', 'Rate', 'Amount in Rs.', 'Remarks', 'Bills'])
    expect(claimSheetRows(claim)).toEqual([
      [0, 1, '01-09-2026', '0-000104 (Sales Internal Cost Project)', 'Own stay', 'NA', 'NA', '-', 4000, '', 'No'],
      [1, 1, '07-09-2026', '0-000104 (Sales Internal Cost Project)', 'Home to Mumbai T2', 'Cab', 8.37, 31.98, 267.71, 'uber', 'No'],
    ])
  })

  describe('expense form checks', () => {
    const draft = { trip: '1', date: '2026-09-07', project: 'P', particulars: '', route: [{ name: '' }, { name: '' }], mode: 'Cab', kms: '', amount: '100', remarks: '' }

    it('builds Particulars from From, stops and To, keeping the pinned locations', () => {
      const route = [{ name: 'Home', lat: 23.2, lng: 72.6 }, { name: 'Sachivalaya' }, { name: 'Office' }]
      expect(parseDraft({ ...draft, route }, '2026-09')).toMatchObject({ particulars: 'Home to Sachivalaya to Office', route })
    })

    it('refuses an empty stop and an expense with neither route nor particulars', () => {
      expect(parseDraft({ ...draft, route: [{ name: 'Home' }, { name: '' }, { name: 'Office' }] }, '2026-09')).toMatch(/every stop/)
      expect(parseDraft(draft, '2026-09')).toMatch(/Particulars/)
    })

    it('computes the own-vehicle amount from kms and needs the kms', () => {
      expect(parseDraft({ ...draft, particulars: 'Home to Office', mode: 'Own vehicle', kms: '10', amount: '' }, '2026-09')).toMatchObject({ amount: 80, kms: 10 })
      expect(parseDraft({ ...draft, particulars: 'Home to Office', mode: 'Own vehicle', amount: '' }, '2026-09')).toMatch(/kms/)
    })

    it('drops the route and kms for non-travel rows', () => {
      expect(parseDraft({ ...draft, mode: 'NA', particulars: 'Hotel stay', kms: '5', route: [{ name: 'X' }, { name: 'Y' }] }, '2026-09')).toMatchObject({ route: undefined, kms: null })
    })
  })

  it('names the merged PDF "Name Surname_Mon-Year_Consolidated Bills"', async () => {
    const { consolidatedBillsFileName } = await import('./model')
    expect(consolidatedBillsFileName('Shubham Mehra', '2026-09')).toBe('Shubham Mehra_Sep-2026_Consolidated Bills.pdf')
    expect(consolidatedBillsFileName('A/B: "x"', '2026-12')).toBe('A B x_Dec-2026_Consolidated Bills.pdf')
    expect(consolidatedBillsFileName('  ', '2027-01')).toBe('Reimbursement_Jan-2027_Consolidated Bills.pdf')
  })
})
