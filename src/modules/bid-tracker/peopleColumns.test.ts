import { describe, expect, it } from 'vitest'
import { coerceCustomValue, matchesTypedRule, normalizePeopleColumnConfig } from '@goms/domain'
import type { OrgPerson } from '@/data/org-structure'
import type { BidCustomField, SalesPerson, SalesPosting } from '@/lib/types'
import { NO_LOOKUPS, STANDARD_COLUMNS, customColumnMeta, type ColumnOption } from './gridColumns'
import {
  buildPeopleScope, canHoldMultiple, columnPeople, employeeOptions, isMultiPersonColumn, matchingPeople, personStorage, scopedOptionsOf,
  territoryForState, toCandidates, type PeopleLookups, type PersonCandidate,
} from './peopleColumns'

const col = (id: string) => STANDARD_COLUMNS.find((c) => c.id === id)!
const customPerson = customColumnMeta({ id: 'f1', key: 'oem_contact', name: 'OEM contact', dataType: 'person' } as BidCustomField)

const person = (value: string, departments: string[], territory: string | null, verticals: string[] = []): PersonCandidate =>
  ({ value, label: value, departments, verticals, territory, isPerson: true })

const candidates = [
  person('north-am', ['Sales'], 'North'),
  person('south-am', ['Sales'], 'South'),
  person('bu-head', ['Sales'], null), // pan-India
  person('legal-1', ['Legal'], null),
  person('bid-1', ['Bid Management'], null),
]
const values = (list: { value: string }[]) => list.map((c) => c.value)

describe('personStorage / canHoldMultiple', () => {
  it('reads what each person column stores', () => {
    expect(personStorage(col('geoSalesPersonId'))).toBe('sales')
    expect(personStorage(col('ownerEmail'))).toBe('salesEmail')
    expect(personStorage(col('nextActionAssigneeEmail'))).toBe('salesEmail')
    expect(personStorage(col('legalPersonId'))).toBe('legal')
    expect(personStorage(customPerson)).toBe('employees')
    expect(personStorage(col('opportunityName'))).toBeNull()
  })

  it('only custom person columns can hold several people', () => {
    expect(canHoldMultiple(customPerson)).toBe(true)
    expect(canHoldMultiple(col('geoSalesPersonId'))).toBe(false)
    expect(canHoldMultiple(col('ownerEmail'))).toBe(false)
  })
})

describe('columnPeople', () => {
  it('offers every candidate when the column has no setup', () => {
    expect(values(columnPeople(candidates, undefined, null))).toEqual(values(candidates))
  })

  it('offers everyone in the chosen departments (case-insensitive)', () => {
    const config = normalizePeopleColumnConfig({ departments: ['legal', 'Bid Management'] })
    expect(values(columnPeople(candidates, config, null))).toEqual(['legal-1', 'bid-1'])
  })

  it('offers individually picked people', () => {
    expect(values(columnPeople(candidates, normalizePeopleColumnConfig({ people: ['south-am'] }), null))).toEqual(['south-am'])
  })

  it('offers departments plus picks together', () => {
    const config = normalizePeopleColumnConfig({ departments: ['Legal'], people: ['north-am'] })
    expect(values(columnPeople(candidates, config, null))).toEqual(['north-am', 'legal-1'])
  })

  it('a setup that only switches on Multiple keeps everyone', () => {
    expect(columnPeople(candidates, normalizePeopleColumnConfig({ multiple: true }), null)).toHaveLength(candidates.length)
  })

  it('offers employees in the chosen verticals AND departments; an empty choice does not narrow', () => {
    const staff = [
      person('traffic-presales', ['Pre-Sales'], null, ['Traffic']),
      person('traffic-legal', ['Legal'], null, ['Traffic']),
      person('transit-presales', ['Pre-Sales'], null, ['Transit (Mobility)']),
      person('no-vertical', ['Pre-Sales'], null),
    ]
    expect(values(matchingPeople(staff, ['traffic'], []))).toEqual(['traffic-presales', 'traffic-legal'])
    expect(values(matchingPeople(staff, [], ['Pre-Sales']))).toEqual(['traffic-presales', 'transit-presales', 'no-vertical'])
    expect(values(matchingPeople(staff, ['Traffic', 'Transit (Mobility)'], ['Pre-Sales']))).toEqual(['traffic-presales', 'transit-presales'])
    expect(values(columnPeople(staff, normalizePeopleColumnConfig({ verticals: ['Traffic'], departments: ['Legal'] }), null))).toEqual(['traffic-legal'])
  })

  it("narrows to the row's territory, keeping pan-India people", () => {
    expect(values(columnPeople(candidates, undefined, 'South'))).toEqual(['south-am', 'bu-head', 'legal-1', 'bid-1'])
  })

  it('applies the territory after the setup', () => {
    const config = normalizePeopleColumnConfig({ departments: ['Sales'] })
    expect(values(columnPeople(candidates, config, 'North'))).toEqual(['north-am', 'bu-head'])
  })
})

describe('territoryForState', () => {
  const states: ColumnOption[] = [{ value: '27', label: 'Maharashtra' }, { value: '24', label: 'Gujarat' }, { value: '99', label: 'Atlantis' }]
  it('maps a state code to its sales territory by name', () => {
    expect(territoryForState(27, states)).toBe('South')
    expect(territoryForState('24', states)).toBe('West')
  })
  it('has no territory for an unknown or missing state', () => {
    expect(territoryForState(99, states)).toBeNull()
    expect(territoryForState(null, states)).toBeNull()
    expect(territoryForState(5, states)).toBeNull()
  })
})

describe('buildPeopleScope + scopedOptionsOf', () => {
  const sp = (id: string, name: string, email: string) => ({ id, name, officialEmail: email, photoUrl: null }) as unknown as SalesPerson
  const salesPersons = [
    sp('head', 'Sales Head', 'jayendra@amnex.com'),
    sp('rajesh', 'Rajesh', 'rajeshl@amnex.com'),
    sp('suhas', 'Suhas', 'suhas@amnex.com'),
    sp('rohit', 'Rohit', 'rohitt@amnex.com'),
    sp('vishal', 'Vishal', 'vishal4@amnex.com'),
    sp('bu', 'BU Head', 'manoj4@amnex.com'),
  ]
  const posting = (managerId: string | null, designation = 'Account Manager') => ({ managerId, designation }) as SalesPosting
  const currentPostings: Record<string, SalesPosting> = {
    head: posting(null, 'Sales Head'), rajesh: posting('head', 'Regional Head'), suhas: posting('rajesh', 'Regional Manager'),
    rohit: posting('head', 'Regional Head'), vishal: posting('rohit'), bu: posting('head', 'BU Sales Smart City & EPC'),
  }
  const orgPeople = [{ id: 'o1', name: 'Suhas', email: 'suhas@amnex.com', departments: ['Sales', 'Key Accounts'], level: 3, designation: '', managerId: null, status: 'active', createdAt: '' }] as OrgPerson[]
  const scope = buildPeopleScope({ configs: {}, salesPersons, currentPostings, deliveryTeamMembers: [], orgPeople })
  const lookups: PeopleLookups = {
    ...NO_LOOKUPS,
    persons: salesPersons.map((p) => ({ value: p.id, label: p.name, email: p.officialEmail, isPerson: true })),
    states: [{ value: '27', label: 'Maharashtra' }, { value: '9', label: 'Uttar Pradesh' }],
    people: scope,
  }

  it("resolves each sales person's territory from the live reporting chain (heads without one are pan-India)", () => {
    expect(scope.territoryByEmail.get('suhas@amnex.com')).toBe('South')
    expect(scope.territoryByEmail.get('vishal4@amnex.com')).toBe('North')
    expect(scope.territoryByEmail.get('manoj4@amnex.com')).toBeNull()
    expect(scope.territoryByEmail.get('jayendra@amnex.com')).toBeNull()
  })

  it('takes departments from the master employee list, else the roster default', () => {
    const [suhas, vishal] = toCandidates(lookups.persons.filter((p) => ['suhas', 'vishal'].includes(p.value)), 'sales', scope)
    expect(suhas.departments).toEqual(['Sales', 'Key Accounts'])
    expect(vishal.departments).toEqual(['Sales'])
  })

  it("shows only the row's territory and pan-India people in a sales column", () => {
    expect(values(scopedOptionsOf(col('geoSalesPersonId'), lookups, 27, null))).toEqual(['head', 'rajesh', 'suhas', 'bu'])
    expect(values(scopedOptionsOf(col('geoSalesPersonId'), lookups, 9, null))).toEqual(['head', 'rohit', 'vishal', 'bu'])
  })

  it('keeps the current person listed even outside the territory or setup', () => {
    expect(values(scopedOptionsOf(col('geoSalesPersonId'), lookups, 27, 'vishal'))).toContain('vishal')
    const withSetup: PeopleLookups = { ...lookups, people: { ...scope, configs: { [customPerson.id]: { verticals: [], departments: [], people: ['bu'], multiple: false } } } }
    expect(values(scopedOptionsOf(customPerson, withSetup, null, 'rohit'))).toEqual(['rohit', 'bu'])
  })

  it('built-in columns ignore any stored setup (only the territory narrows them)', () => {
    const stale: PeopleLookups = { ...lookups, people: { ...scope, configs: { buSalesPersonId: { verticals: [], departments: [], people: ['bu'], multiple: false } } } }
    expect(scopedOptionsOf(col('buSalesPersonId'), stale, null, null)).toHaveLength(salesPersons.length)
  })

  it('a custom People column offers Amnex employees in its verticals and departments', () => {
    const org = [
      { id: 'o-suhas', name: 'Suhas', email: 'suhas@amnex.com', departments: ['Sales'], verticals: ['Traffic'], level: 3, designation: '', managerId: null, status: 'active', createdAt: '' },
      { id: 'o-meera', name: 'Meera', email: 'meera@amnex.com', departments: ['Pre-Sales'], verticals: ['Traffic'], level: 4, designation: '', managerId: null, status: 'active', createdAt: '' },
      { id: 'o-old', name: 'Gone', email: 'gone@amnex.com', departments: ['Pre-Sales'], verticals: ['Traffic'], level: 4, designation: '', managerId: null, status: 'inactive', createdAt: '' },
    ] as OrgPerson[]
    const employees = employeeOptions(org, salesPersons)
    // Org people (active) plus Sales-roster people not in the org; Suhas appears once, as his org record.
    expect(values(employees)).toEqual(['bu', 'o-meera', 'rajesh', 'rohit', 'head', 'o-suhas', 'vishal'])
    const orgScope = buildPeopleScope({ configs: { [customPerson.id]: normalizePeopleColumnConfig({ verticals: ['Traffic'], departments: ['Pre-Sales'] }) }, salesPersons, currentPostings, deliveryTeamMembers: [], orgPeople: org })
    expect(values(scopedOptionsOf(customPerson, { ...lookups, employees, people: orgScope }, 27, null))).toEqual(['o-meera'])
  })

  it('email-keyed columns are narrowed the same way (values stay emails)', () => {
    const options = scopedOptionsOf(col('ownerEmail'), lookups, 27, '')
    expect(values(options)).toEqual(['jayendra@amnex.com', 'rajeshl@amnex.com', 'suhas@amnex.com', 'manoj4@amnex.com'])
  })

  it('leaves lists alone without a people scope, and Multiple applies to custom person columns only', () => {
    expect(scopedOptionsOf(col('geoSalesPersonId'), { ...lookups, people: undefined }, 27, null)).toHaveLength(salesPersons.length)
    const multi: PeopleLookups = { ...lookups, people: { ...scope, configs: { [customPerson.id]: { verticals: [], departments: [], people: [], multiple: true }, geoSalesPersonId: { verticals: [], departments: [], people: [], multiple: true } } } }
    expect(isMultiPersonColumn(customPerson, multi)).toBe(true)
    expect(isMultiPersonColumn(col('geoSalesPersonId'), multi)).toBe(false)
  })
})

describe('multi-person custom values (domain)', () => {
  it('stores several people as a JSON list and one person as a plain id', () => {
    expect(coerceCustomValue('person', '["a","b","a"]')).toBe('["a","b"]')
    expect(coerceCustomValue('person', '["a"]')).toBe('a')
    expect(coerceCustomValue('person', 'a')).toBe('a')
    expect(coerceCustomValue('person', '[]')).toBeNull()
    expect(() => coerceCustomValue('person', JSON.stringify(Array.from({ length: 21 }, (_, i) => `p${i}`)))).toThrow()
  })

  it('a person filter matches any person in a multi-person cell', () => {
    expect(matchesTypedRule('person', '["a","b"]', { operator: 'eq' }, 'b')).toBe(true)
    expect(matchesTypedRule('person', 'a', { operator: 'eq' }, 'a')).toBe(true)
    expect(matchesTypedRule('person', '["a","b"]', { operator: 'in', values: ['c', 'a'] }, '')).toBe(true)
  })

  it('normalizes a setup: trimmed, de-duplicated, bounded', () => {
    expect(normalizePeopleColumnConfig({ departments: [' Sales ', 'Sales', ''], people: ['x', 'x'], multiple: 'yes' }))
      .toEqual({ verticals: [], departments: ['Sales'], people: ['x'], multiple: false })
    expect(() => normalizePeopleColumnConfig({ people: Array.from({ length: 501 }, (_, i) => `p${i}`) })).toThrow()
  })
})
