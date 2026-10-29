/** Reimbursement claims: one claim per calendar month, holding that month's expense rows and their bills. */

export const CLAIM_STATUSES = [
  { value: 'collecting', label: 'Collecting', hint: 'Adding expenses and bills' },
  { value: 'submitted', label: 'Submitted', hint: 'Waiting for HOD approval' },
  { value: 'hod', label: 'HOD approved', hint: 'Waiting for Admin approval' },
  { value: 'admin', label: 'Admin approved', hint: 'Waiting for Finance approval' },
  { value: 'finance', label: 'Finance approved', hint: 'Waiting to be credited' },
  { value: 'credited', label: 'Credited', hint: 'Check it on your payslip' },
  { value: 'closed', label: 'Closed', hint: 'Verified on the payslip' },
] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]['value']

export const MODES = ['Cab', 'Auto', 'Rickshaw', 'Bus', 'Train', 'Metro', 'Flight', 'Own vehicle', 'Own two-wheeler', 'NA'] as const
export type BillState = 'Yes' | 'No'
/** Company rates for travel in your own four- and two-wheeler, rupees per km. */
export const OWN_VEHICLE_RATE = 8
export const TWO_WHEELER_RATE = 3
/** Modes paid per km: the amount is kms × rate, never typed. */
export const PER_KM_RATE: Readonly<Record<string, number>> = { 'Own vehicle': OWN_VEHICLE_RATE, 'Own two-wheeler': TWO_WHEELER_RATE }

/** A point on a journey; lat/lng and placeId come from Google Maps when the place was picked there. */
export interface Place { name: string; address?: string; lat?: number; lng?: number; placeId?: string }

export interface Attachment {
  id: string
  /** `<row code>-A<n>`: the Drive file is named with it, so a bill always matches its row. */
  code: string
  originalName: string
  mimeType: string
  size: number
  driveId?: string
  webViewLink?: string
  /** pending: only in this browser session; saved: in the user's Drive; error: the upload failed. */
  state: 'pending' | 'saved' | 'error'
  error?: string
}

export interface Expense {
  id: string
  trip: number
  /** yyyy-mm-dd; empty when the row is a consolidated item without one date. */
  date: string
  project: string
  particulars: string
  /** From, any stops, To — in travel order. Absent for rows that are not a journey (stay, printouts). */
  route?: Place[]
  mode: string
  /** null = NA. */
  kms: number | null
  amount: number
  remarks: string
  attachments: Attachment[]
  createdAt: string
}

export interface Claim {
  /** yyyy-mm */
  month: string
  status: ClaimStatus
  /** When each status was reached (yyyy-mm-dd). */
  statusDates: Partial<Record<ClaimStatus, string>>
  expenses: Expense[]
}

export const statusIndex = (status: ClaimStatus) => CLAIM_STATUSES.findIndex((s) => s.value === status)
export const statusLabel = (status: ClaimStatus) => CLAIM_STATUSES[statusIndex(status)].label
export const isEditable = (claim: Claim) => claim.status === 'collecting'

export const emptyClaim = (month: string): Claim => ({ month, status: 'collecting', statusDates: {}, expenses: [] })

export const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
export const monthLabel = (month: string, style: 'long' | 'short' = 'long') =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: style, year: 'numeric' })

/** Rows in claim order: trip, then date, then entry order. Record numbers count within a trip. */
export function sequence(expenses: readonly Expense[]): { expense: Expense; record: number }[] {
  const sorted = [...expenses].sort((a, b) => a.trip - b.trip || (a.date || '').localeCompare(b.date || '') || a.createdAt.localeCompare(b.createdAt))
  const counts = new Map<number, number>()
  return sorted.map((expense) => {
    const record = (counts.get(expense.trip) ?? 0) + 1
    counts.set(expense.trip, record)
    return { expense, record }
  })
}

/** RB-202609-T02-R03: month, trip, record. Stable for a given position in the claim. */
export function rowCode(month: string, trip: number, record: number): string {
  return `RB-${month.replace('-', '')}-T${String(trip).padStart(2, '0')}-R${String(record).padStart(2, '0')}`
}

/** The claim's rows in order, each with its row code. */
export function orderedRows(claim: Claim) {
  return sequence(claim.expenses).map((row) => ({ ...row, code: rowCode(claim.month, row.expense.trip, row.record) }))
}

export const attachmentCode = (row: string, index: number) => `${row}-A${index + 1}`

/** The Drive file name for an attachment: its code plus the original extension. */
export function attachmentFileName(code: string, originalName: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(originalName)?.[1]
  return ext ? `${code}.${ext.toLowerCase()}` : code
}

/** Gives every attachment the code of its current position; `renamed` lists saved files whose Drive name must follow. */
export function recode(claim: Claim): { claim: Claim; renamed: Attachment[] } {
  const codes = new Map(orderedRows(claim).map((row) => [row.expense.id, row.code]))
  const renamed: Attachment[] = []
  const expenses = claim.expenses.map((e) => ({
    ...e,
    attachments: e.attachments.map((a, i) => {
      const code = attachmentCode(codes.get(e.id)!, i)
      if (code === a.code) return a
      const next = { ...a, code }
      if (a.state === 'saved') renamed.push(next)
      return next
    }),
  }))
  return { claim: { ...claim, expenses }, renamed }
}

/** No until a bill is attached. */
export const billState = (e: Expense): BillState => (e.attachments.length ? 'Yes' : 'No')

/** "A to B to C" for a route. */
export const routeText = (route: readonly Place[]) => route.map((p) => p.name.trim()).filter(Boolean).join(' to ')

export const ownVehicleAmount = (kms: number, rate = OWN_VEHICLE_RATE) => Math.round(kms * rate * 100) / 100

/** Rupees per km, as the claim sheet shows it; null when the row has no distance. */
export const rateOf = (e: Expense): number | null => (e.kms && e.kms > 0 ? Math.round((e.amount / e.kms) * 100) / 100 : null)

export const claimTotal = (claim: Claim) => Math.round(claim.expenses.reduce((sum, e) => sum + e.amount, 0) * 100) / 100

/** How many rows have at least one bill attached. */
export function billCoverage(claim: Claim): { covered: number; needed: number } {
  return { covered: claim.expenses.filter((e) => e.attachments.length > 0).length, needed: claim.expenses.length }
}

/** Moves the claim to `status`, stamping today when it is a step forward. Going back clears the later stamps. */
export function setStatus(claim: Claim, status: ClaimStatus, today: string): Claim {
  const target = statusIndex(status)
  const statusDates = Object.fromEntries(
    Object.entries(claim.statusDates).filter(([s]) => statusIndex(s as ClaimStatus) <= target),
  ) as Claim['statusDates']
  if (!statusDates[status] && status !== 'collecting') statusDates[status] = today
  return { ...claim, status, statusDates }
}

/** "Mumbai T1 to Hotel" → "Hotel to Mumbai T1"; other text is kept as is. */
export function returnTrip(particulars: string): string {
  const parts = particulars.split(/\s+to\s+/i)
  return parts.length === 2 ? `${parts[1].trim()} to ${parts[0].trim()}` : particulars
}

export const formatINR = (value: number) =>
  `₹${value.toLocaleString('en-IN', { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

/** "Shubham Mehra_Sep-2026_Consolidated Bills.pdf": the claimant, the claim month, and what the file is. */
export const consolidatedBillsFileName = (person: string, month: string) => claimFileName(person, month, 'Consolidated Bills', 'pdf')

export function claimFileName(person: string, month: string, what: string, ext: string): string {
  const name = person.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Reimbursement'
  const [y, m] = month.split('-').map(Number)
  const mon = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' }).slice(0, 3)
  return `${name}_${mon}-${y}_${what}.${ext}`
}

/** dd-mm-yyyy, as on the claim sheet. */
export const sheetDate = (iso: string) => (iso ? iso.split('-').reverse().join('-') : '')
