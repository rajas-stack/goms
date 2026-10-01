import { describe, expect, it } from 'vitest'
import type { BidCustomField, OwnershipAssignment, SalesPerson } from '@/lib/types'
import type { CommercialAuditLog } from '@/modules/commercial-calculator/types'
import {
  NO_ACTIVITY_FILTERS, buildActivityItems, filterActivity, formatWhen, groupActivity, humanize, personName,
  type FeedContext,
} from './activityFeed'
import { buildLookups } from './gridColumns'

const field = (key: string, name: string, dataType: BidCustomField['dataType'], options: string[] | null = null): BidCustomField => ({
  id: `f-${key}`, key, name, dataType, sheet: 'bidTracker', options, hasHeldValue: true, position: 0, status: 'active', createdBy: null, updatedBy: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
})
const person = (id: string, name: string, officialEmail: string) => ({ id, name, officialEmail }) as SalesPerson
const people = [person('p-1', 'Shubham Rao', 'shubham@amnex.com')]
const ctx = (over: Partial<FeedContext> = {}): FeedContext => ({
  customFields: [field('budget', 'Budget', 'currency'), field('regions', 'Regions', 'multiselect', ['West', 'North']), field('lead', 'Lead', 'person')],
  lookups: buildLookups({ persons: [{ id: 'p-1', name: 'Shubham Rao' }], departments: [], states: [{ code: 24, name: 'Gujarat' }] }),
  people, corrigendumBid: new Map(), ...over,
})
let n = 0
const log = (over: Partial<CommercialAuditLog>): CommercialAuditLog => ({
  id: `l${++n}`, entityType: 'bid', entityId: 'bid-1', field: 'city', oldValue: '', newValue: '', reason: '', action: 'update',
  changedAt: '2026-10-01T12:14:00Z', changedBy: 'shubham@amnex.com', ...over,
})
const one = (l: CommercialAuditLog, c = ctx()) => buildActivityItems([l], [], c)[0]

describe('readable activity items', () => {
  it('names the field, the person, and shows old → new — never raw field names', () => {
    const item = one(log({ field: 'emdAmount', oldValue: '500000', newValue: '750000' }))
    expect(item.title).toBe('EMD Amount changed')
    expect(item.changes).toEqual([{ label: 'EMD Amount', from: '500000', to: '750000' }])
    expect(item.byName).toBe('Shubham Rao')
    expect(item.bidId).toBe('bid-1')
  })

  it('says set / cleared when one side is empty', () => {
    expect(one(log({ field: 'city', oldValue: '', newValue: 'Pune' })).title).toBe('City set')
    expect(one(log({ field: 'city', oldValue: 'Pune', newValue: '' })).title).toBe('City cleared')
    expect(one(log({ field: 'vertical', oldValue: 'a', newValue: 'b' })).changes[0].label).toBe('Sector')
  })

  it('stage and decision use the product wording', () => {
    const stage = one(log({ field: 'stageKey', oldValue: 'solutioning', newValue: 'preBidQueries' }))
    expect(stage).toMatchObject({ kind: 'stage', title: 'Stage changed' })
    expect(stage.changes[0]).toEqual({ label: 'Bid Stage', from: 'Solutioning', to: 'Pre-bid Queries' })
    expect(one(log({ field: 'decision', oldValue: 'pending', newValue: 'no_go' })).changes[0]).toMatchObject({ from: 'Pending', to: 'No-Go' })
  })

  it('verification, freezing and unfreezing read as sentences', () => {
    expect(one(log({ action: 'mark_verified', field: 'dataConfidence', oldValue: 'needs_review', newValue: 'verified' }))).toMatchObject({ kind: 'verify', title: 'Bid verified', changes: [] })
    expect(one(log({ action: 'freeze', field: 'emdAmount' })).title).toBe('EMD Amount protected')
    const un = one(log({ action: 'unfreeze', field: 'emdAmount', reason: 'Client revised' }))
    expect(un).toMatchObject({ kind: 'protect', title: 'EMD Amount unprotected', note: 'Reason: Client revised' })
  })

  it('custom column edits use the column NAME and format by its type', () => {
    const cur = one(log({ entityType: 'bidCustomFieldValue', field: 'budget', oldValue: '500000', newValue: '750000', action: 'custom_value_set' }))
    expect(cur.title).toBe('Budget changed')
    expect(cur.changes[0]).toEqual({ label: 'Budget', from: '₹5,00,000', to: '₹7,50,000' })
    const multi = one(log({ entityType: 'bidCustomFieldValue', field: 'regions', newValue: '["West","North"]', action: 'custom_value_set' }))
    expect(multi.changes[0]).toMatchObject({ from: null, to: 'West, North' })
    // Older audit rows hold the entity's id: it is resolved to a name.
    expect(one(log({ entityType: 'bidCustomFieldValue', field: 'lead', newValue: 'p-1', action: 'custom_value_set' })).changes[0].to).toBe('Shubham Rao')
    // A column since archived or unknown still gets a readable name.
    expect(one(log({ entityType: 'bidCustomFieldValue', field: 'client_contact', newValue: 'Ravi' })).changes[0].label).toBe('Client Contact')
  })

  it('corrigenda link back to their bid, and column / view changes belong to no bid', () => {
    const corr = one(
      log({ entityType: 'bidCorrigendum', entityId: 'c-1', field: 'submissionDeadline', oldValue: '2026-10-10', newValue: '2026-10-20', action: 'corrigendum_accepted' }),
      ctx({ corrigendumBid: new Map([['c-1', 'bid-7']]) }),
    )
    expect(corr).toMatchObject({ kind: 'corrigendum', bidId: 'bid-7', title: 'Corrigendum accepted: Submission Deadline' })
    expect(corr.changes[0]).toEqual({ label: 'Submission Deadline', from: '10 Oct 2026', to: '20 Oct 2026' })
    const col = one(log({ entityType: 'bidCustomField', field: 'name', newValue: 'Budget', action: 'custom_field_created' }))
    expect(col).toMatchObject({ kind: 'column', title: 'Column “Budget” added', bidId: null })
  })

  it('ignores audit rows that are not Bid Tracker history', () => {
    expect(buildActivityItems([log({ entityType: 'commercialSku' })], [], ctx())).toEqual([])
  })

  it('merges ownership history in, newest first, bid-level only', () => {
    const a = (over: Partial<OwnershipAssignment>) => ({
      id: 'a1', entityType: 'bid', entityId: 'bid-1', salesPersonId: 'p-1', role: 'owner', startDate: '2026-10-02', endDate: null,
      createdAt: '2026-10-02', createdBy: 'shubham@amnex.com', ...over,
    }) as OwnershipAssignment
    const items = buildActivityItems([log({ field: 'city', newValue: 'Pune' })], [a({}), a({ id: 'a2', entityType: 'opportunity' })], ctx())
    expect(items.map((i) => i.title)).toEqual(['Owner assigned: Shubham Rao', 'City set'])
    expect(items[0]).toMatchObject({ kind: 'ownership', note: 'from 02 Oct 2026', bidId: 'bid-1' })
  })
})

describe('names and dates', () => {
  it('turns an email into a name when there is no Sales Team match', () => {
    expect(personName('rajas.saji@amnex.com', [])).toBe('Rajas Saji')
    expect(personName('shubham@amnex.com', people)).toBe('Shubham Rao')
    expect(personName(null, [])).toBe('System')
  })
  it('humanizes keys and writes dates like 01 Oct 2026', () => {
    expect(humanize('nextActionNote')).toBe('Next Action Note')
    expect(humanize('client_contact')).toBe('Client Contact')
    expect(formatWhen('2026-10-01')).toBe('01 Oct 2026')
    expect(formatWhen('2026-10-01T12:14:00')).toMatch(/^01 Oct 2026, \d{2}:\d{2}$/)
  })
})

describe('grouping and filtering', () => {
  const at = (s: string) => `2026-10-01T12:${s}Z`
  const items = () => buildActivityItems([
    log({ field: 'city', newValue: 'Pune', changedAt: at('14:00') }),
    log({ field: 'vertical', newValue: 'Smart City', changedAt: at('14:30') }),
    log({ field: 'city', newValue: 'Surat', changedAt: at('20:00'), changedBy: 'asha@amnex.com' }),
    log({ field: 'city', newValue: 'Goa', entityId: 'bid-2', changedAt: at('18:10') }),
    log({ action: 'mark_verified', field: 'dataConfidence', newValue: 'verified', changedAt: at('15:00') }),
    log({ entityType: 'bidSavedView', action: 'update', field: 'patch', newValue: '{}', changedAt: at('16:00') }),
  ], [], ctx())

  it('folds quick edits by one person to one bid into a single entry', () => {
    const groups = groupActivity(items().filter((i) => !i.minor))
    // Newest first: Surat (other person), Goa (other bid), verified, then Smart City + Pune together.
    expect(groups.map((g) => g.items.length)).toEqual([1, 1, 1, 2])
    expect(groups[3].items.map((i) => i.title)).toEqual(['Sector set', 'City set'])
  })

  it('does not fold different people, other bids, or non-edits', () => {
    const groups = groupActivity(items().filter((i) => !i.minor))
    expect(groups.some((g) => g.items.some((i) => i.kind === 'verify') && g.items.length > 1)).toBe(false)
  })

  const label = (id: string) => (id === 'bid-1' ? 'BID-2026-0001 Alpha' : 'BID-2026-0002 Beta')
  it('filters by bid, user, activity type and date range; housekeeping is hidden unless asked for', () => {
    const all = items()
    expect(filterActivity(all, NO_ACTIVITY_FILTERS, label)).toHaveLength(5) // the saved-view tweak is hidden
    expect(filterActivity(all, { ...NO_ACTIVITY_FILTERS, bidId: 'bid-2' }, label).map((i) => i.changes[0]?.to)).toEqual(['Goa'])
    expect(filterActivity(all, { ...NO_ACTIVITY_FILTERS, by: 'asha@amnex.com' }, label)).toHaveLength(1)
    expect(filterActivity(all, { ...NO_ACTIVITY_FILTERS, kind: 'verify' }, label)).toHaveLength(1)
    expect(filterActivity(all, { ...NO_ACTIVITY_FILTERS, kind: 'column' }, label)).toHaveLength(1)
    expect(filterActivity(all, { ...NO_ACTIVITY_FILTERS, from: '2099-01-01' }, label)).toHaveLength(0)
    expect(filterActivity(all, { ...NO_ACTIVITY_FILTERS, from: '2026-10-01', to: '2026-10-01' }, label)).toHaveLength(5)
  })

  it('searches titles, values, people and bid names', () => {
    const all = items()
    expect(filterActivity(all, { ...NO_ACTIVITY_FILTERS, query: 'smart city' }, label)).toHaveLength(1)
    expect(filterActivity(all, { ...NO_ACTIVITY_FILTERS, query: 'beta' }, label)).toHaveLength(1)
    expect(filterActivity(all, { ...NO_ACTIVITY_FILTERS, query: 'verified' }, label)).toHaveLength(1)
    expect(filterActivity(all, { ...NO_ACTIVITY_FILTERS, query: 'nothing like this' }, label)).toHaveLength(0)
  })
})
