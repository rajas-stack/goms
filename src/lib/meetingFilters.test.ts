import { describe, expect, it } from 'vitest'
import {
  buildMeetingFacets, isAccountManagerDesignation, isBuSalesDesignation, matchesMeetingFilters, regionOptions,
  EMPTY_MEETING_FILTERS, type MeetingFacetContext, type MeetingFilters,
} from './meetingFilters'
import type { Employee, SalesPerson, SalesPosting, TimelineEvent } from './types'

function sp(id: string, name: string, email: string): SalesPerson {
  return {
    id, employeeCode: '', name, officialEmail: email, personalEmail: '', mobile: '', altMobile: '',
    joinedOn: null, leftOn: null, status: 'active', photoUrl: null, notes: '', metadata: {}, createdAt: '', createdBy: null,
  }
}
function posting(personId: string, designation: string, managerId: string | null): SalesPosting {
  return {
    id: `post-${personId}`, salesPersonId: personId, designation, tierKey: 'accountManager', managerId, gmOverrideId: null,
    office: '', startDate: '2024-01-01', endDate: null, changeType: 'initial', reason: '', createdAt: '', createdBy: null,
  }
}

// Mirrors the real roster's shape: two geos (North via Rohit; South via
// Rajesh → a dual-role "Regional Manager & Head" → AM), a West head who
// reports straight to the Sales Head, and a BU Sales person with no geo chain.
const PEOPLE: [SalesPerson, string, string | null][] = [
  [sp('jay', 'Jayendrasinh Puwar', 'jayendra@amnex.com'), 'Sales Head', null],
  [sp('rohit', 'Rohit Tiku', 'rohitt@amnex.com'), 'Regional Head', 'jay'],
  [sp('prameet', 'Prameet Srivastava', 'prameet@amnex.com'), 'Regional Manager', 'rohit'],
  [sp('vishal', 'Vishal Sharma', 'vishal4@amnex.com'), 'Account Manager', 'prameet'],
  [sp('sunil', 'Sunil Kumar Sharma', 'sunilkumar@amnex.com'), 'Regional Manager & Head', 'jay'],
  [sp('ketan', 'Ketan Thakkar', 'ketant@amnex.com'), 'Account Manager', 'sunil'],
  [sp('rajesh', 'Rajesh Lahoria', 'rajeshl@amnex.com'), 'Regional Head', 'jay'],
  [sp('kondala', 'Kondala Rao', 'kondala@amnex.com'), 'Regional Manager & Head', 'rajesh'],
  [sp('kamal', 'Kamal Nair', 'kamal@amnex.com'), 'Account Manager', 'kondala'],
  [sp('prash', 'Prashanth Reddy', 'prashanth@amnex.com'), 'BU Sales Agriculture', 'jay'],
]

function makeCtx(overrides: Partial<MeetingFacetContext> = {}): MeetingFacetContext {
  return {
    salesPersons: PEOPLE.map(([p]) => p),
    currentPostings: Object.fromEntries(PEOPLE.map(([p, d, m]) => [p.id, posting(p.id, d, m)])),
    employeeById: new Map([['emp-1', { id: 'emp-1', name: 'Anita Desai' } as Employee]]),
    deptById: { 'emp-1': { id: 'dept-1', name: 'MeitY' } },
    stateCodeByDeptId: new Map([['dept-1', 24]]),
    ...overrides,
  }
}

function meeting(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return { id: 'm1', employeeId: 'emp-1', type: 'meeting', title: 'Kickoff', date: '2026-09-01', note: '', source: 'manual', ...overrides }
}

const att = (id: string) => {
  const p = PEOPLE.find(([x]) => x.id === id)![0]
  return { salesPersonId: p.id, name: p.name }
}

describe('designation matchers', () => {
  it('matches Account Manager exactly (case/space-insensitive), not Regional Manager', () => {
    expect(isAccountManagerDesignation('Account Manager')).toBe(true)
    expect(isAccountManagerDesignation('  account manager ')).toBe(true)
    expect(isAccountManagerDesignation('Regional Manager')).toBe(false)
    expect(isAccountManagerDesignation('Senior Account Manager')).toBe(false)
  })
  it('matches any designation containing "BU Sales", as the Commercial Calculator does', () => {
    expect(isBuSalesDesignation('BU Sales Agriculture')).toBe(true)
    expect(isBuSalesDesignation('bu sales data fabrics')).toBe(true)
    expect(isBuSalesDesignation('Account Manager')).toBe(false)
  })
})

describe('buildMeetingFacets', () => {
  it('collects Account Manager and BU Sales attendees by current designation', () => {
    const f = buildMeetingFacets(meeting({ attendees: [att('vishal'), att('prash'), att('prameet')] }), makeCtx())
    expect([...f.accountManagerIds]).toEqual(['vishal'])
    expect([...f.buSalesIds]).toEqual(['prash'])
  })

  it('uses the CURRENT posting, not the attendee snapshot', () => {
    const ctx = makeCtx()
    ctx.currentPostings.vishal = posting('vishal', 'Regional Manager', 'rohit')
    const f = buildMeetingFacets(meeting({ attendees: [att('vishal')] }), ctx)
    expect(f.accountManagerIds.size).toBe(0)
  })

  it('resolves a legacy plain-string attendee by exact name', () => {
    const f = buildMeetingFacets(meeting({ attendees: ['vishal sharma', 'Nobody Known'] }), makeCtx())
    expect([...f.accountManagerIds]).toEqual(['vishal'])
  })

  it('derives region by walking the reporting chain to the head below the Sales Head', () => {
    const north = buildMeetingFacets(meeting({ attendees: [att('vishal')] }), makeCtx())
    expect([...north.regions]).toEqual(['North'])
    // Kondala (RM & Head) reports to Rajesh — the territory is the TOP head's.
    const south = buildMeetingFacets(meeting({ attendees: [att('kamal')] }), makeCtx())
    expect([...south.regions]).toEqual(['South'])
    // Sunil reports directly to the Sales Head, so he is the final head.
    const west = buildMeetingFacets(meeting({ attendees: [att('ketan')] }), makeCtx())
    expect([...west.regions]).toEqual(['West'])
  })

  it('counts a regional head attending as belonging to their own region', () => {
    const f = buildMeetingFacets(meeting({ attendees: [att('rohit')] }), makeCtx())
    expect([...f.regions]).toEqual(['North'])
  })

  it('gives BU Sales and Sales Head attendees no region', () => {
    const f = buildMeetingFacets(meeting({ attendees: [att('prash'), att('jay')] }), makeCtx())
    expect(f.regions.size).toBe(0)
  })

  it('collects every distinct region when attendees span regions', () => {
    const f = buildMeetingFacets(meeting({ attendees: [att('vishal'), att('ketan')] }), makeCtx())
    expect([...f.regions].sort()).toEqual(['North', 'West'])
  })

  it('resolves state through employee → department → stateCode', () => {
    expect(buildMeetingFacets(meeting(), makeCtx()).stateCode).toBe(24)
    expect(buildMeetingFacets(meeting({ employeeId: 'ghost' }), makeCtx()).stateCode).toBeNull()
  })

  it('terminates on a reporting cycle', () => {
    const ctx = makeCtx()
    ctx.currentPostings.rohit = posting('rohit', 'Regional Head', 'vishal')
    expect(() => buildMeetingFacets(meeting({ attendees: [att('vishal')] }), ctx)).not.toThrow()
  })
})

describe('search text', () => {
  const searchOf = (e: Partial<TimelineEvent>) => buildMeetingFacets(meeting(e), makeCtx()).searchText
  it('covers title, notes, agenda, outcome, next steps, person, department, attendees', () => {
    const text = searchOf({
      title: 'Budget sync', note: 'quarterly note', agenda: 'agenda-zeta', outcome: 'outcome-eta', nextSteps: 'steps-theta',
      attendees: [att('vishal')],
    })
    for (const needle of ['budget sync', 'quarterly note', 'agenda-zeta', 'outcome-eta', 'steps-theta', 'anita desai', 'meity', 'vishal sharma']) {
      expect(text).toContain(needle)
    }
  })
})

describe('matchesMeetingFilters', () => {
  const f = (partial: Partial<MeetingFilters>): MeetingFilters => ({ ...EMPTY_MEETING_FILTERS, ...partial })
  const facets = buildMeetingFacets(meeting({ attendees: [att('vishal'), att('prash')], title: 'Kickoff Alpha' }), makeCtx())

  it('passes everything when no facet filter is set', () => {
    expect(matchesMeetingFilters(facets, f({}))).toBe(true)
  })
  it('state', () => {
    expect(matchesMeetingFilters(facets, f({ stateCode: '24' }))).toBe(true)
    expect(matchesMeetingFilters(facets, f({ stateCode: '27' }))).toBe(false)
  })
  it('account manager uses ANY-attendee semantics and excludes meetings with none', () => {
    expect(matchesMeetingFilters(facets, f({ accountManagerId: 'vishal' }))).toBe(true)
    expect(matchesMeetingFilters(facets, f({ accountManagerId: 'ketan' }))).toBe(false)
    const noAttendees = buildMeetingFacets(meeting(), makeCtx())
    expect(matchesMeetingFilters(noAttendees, f({ accountManagerId: 'vishal' }))).toBe(false)
  })
  it('bu sales', () => {
    expect(matchesMeetingFilters(facets, f({ buSalesId: 'prash' }))).toBe(true)
    expect(matchesMeetingFilters(facets, f({ buSalesId: 'other' }))).toBe(false)
  })
  it('region', () => {
    expect(matchesMeetingFilters(facets, f({ region: 'North' }))).toBe(true)
    expect(matchesMeetingFilters(facets, f({ region: 'West' }))).toBe(false)
  })
  it('a multi-attendee meeting appears under each matching region', () => {
    const multi = buildMeetingFacets(meeting({ attendees: [att('vishal'), att('ketan')] }), makeCtx())
    expect(matchesMeetingFilters(multi, f({ region: 'North' }))).toBe(true)
    expect(matchesMeetingFilters(multi, f({ region: 'West' }))).toBe(true)
  })
  it('search is case-insensitive, token-AND, and combines with facet filters', () => {
    expect(matchesMeetingFilters(facets, f({ search: 'KICKOFF' }))).toBe(true)
    expect(matchesMeetingFilters(facets, f({ search: 'kickoff meity' }))).toBe(true)
    expect(matchesMeetingFilters(facets, f({ search: 'kickoff nonexistent' }))).toBe(false)
    expect(matchesMeetingFilters(facets, f({ search: 'kickoff', region: 'West' }))).toBe(false)
    expect(matchesMeetingFilters(facets, f({ search: 'kickoff', region: 'North', stateCode: '24' }))).toBe(true)
  })
})

describe('regionOptions', () => {
  it('labels each territory with its head, and only for heads present in the roster', () => {
    const opts = regionOptions(makeCtx())
    expect(opts).toEqual([
      { value: 'North', label: 'Rohit Tiku (North)' },
      { value: 'South', label: 'Rajesh Lahoria (South)' },
      { value: 'West', label: 'Sunil Kumar Sharma (West)' },
    ])
  })
})
