import { describe, expect, it } from 'vitest'
import { buildConveyanceWorkbook, claimPeriod } from './conveyanceForm'
import { emptyClaim, type Expense } from './model'

const expense = (over: Partial<Expense>): Expense => ({
  id: Math.random().toString(36), trip: 1, date: '2026-06-09', project: '0-000104 (Sales Internal Cost Project)', particulars: 'Home to Mumbai Airport',
  mode: 'Cab', kms: 8.4, amount: 296, remarks: '', attachments: [], createdAt: '2026-06-09T00:00:00Z', ...over,
})
const who = { employeeCode: '3096', employeeName: 'Shubham Mehra', baseLocation: 'Mumbai', businessUnit: 'Corporate' }

describe('Local Conveyance Form', () => {
  it('works out the claim period from the first and last expense', () => {
    const claim = { ...emptyClaim('2026-06'), expenses: [expense({ date: '2026-06-13' }), expense({ date: '2026-06-09' })] }
    expect(claimPeriod(claim)).toBe('9th June 2026 - 13th June 2026')
    expect(claimPeriod(emptyClaim('2026-02'))).toBe('1st February 2026 - 28th February 2026')
  })

  it('fills the header, the rows in claim order, the total and the sign-off lines', async () => {
    const claim = { ...emptyClaim('2026-06'), expenses: [expense({ date: '2026-06-13', particulars: 'Airport to Hotel', amount: 104, kms: 4 }), expense({})] }
    const ws = (await buildConveyanceWorkbook(claim, who, null)).getWorksheet('Local Conveyance')!
    const v = (ref: string) => ws.getCell(ref).value
    expect(v('D2')).toBe('Local Conveyance Form')
    expect([v('C4'), v('D4'), v('C5'), v('D5'), v('D6')]).toEqual(['3096', 'Base Location: Mumbai', 'Shubham Mehra', 'Project Name: 0-000104 (Sales Internal Cost Project)', 'BU - Corporate'])
    expect(v('C6')).toBe('9th June 2026 - 13th June 2026')
    expect(String(v('A7'))).toContain('Four Wheeler is 8.0 Rs./KM')
    expect([v('A9'), v('C9'), v('E9'), v('G9')]).toEqual(['09-06-2026', 'Home to Mumbai Airport', 8.4, 296])
    expect([v('A10'), v('C10'), v('F10')]).toEqual(['13-06-2026', 'Airport to Hotel', 26])
    expect([v('C23'), v('G23')]).toEqual(['Total', 400]) // 14 lines (rows 9-22) then the total
    expect([v('A25'), v('A27'), v('C27'), v('D27')]).toEqual(['Signature', 'Submitter', 'Team Leader', 'Verified by Admin/ Finance Department'])
    expect(ws.getCell('H27').border?.right?.style).toBe('thin')
  }, 30_000) // first ExcelJS import is slow on a busy machine
})
