import { randomUUID } from 'node:crypto'
import { SEARCH_CATEGORIES } from '@goms/domain'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../../../db.js'
import {
  addEmployee, addNode, addSalesPerson, assignOwner, cleanupRbacFixtures, rbacEmail, setRole,
} from '../../../testHelpers/rbacFixtures.js'
import { decide } from '../decide.js'
import { loadUserFacts } from '../userFacts.js'
import { accountMappingPolicy } from './accountMapping.js'
import { SEARCH_CATEGORY_MODULES, filterSearchResults, maskAuditList, redactSalesRoster } from './masks.js'

const facts = async (label: string) => loadUserFacts(rbacEmail(label))
const denied = async (label: string, path: string, raw?: unknown) => (await decide(path, raw, await facts(label))).denial !== null

let salesId: string, rivalId: string, nodeId: string, geoId: string, empId: string
beforeEach(async () => {
  await cleanupRbacFixtures()
  salesId = await addSalesPerson('sales'); rivalId = await addSalesPerson('rival')
  for (const role of ['bid', 'cxo', 'delivery', 'it', 'finance', 'legal', 'presales'] as const) await setRole(role, role)
  nodeId = await addNode('org', 'dept'); geoId = await addNode('geo', 'state')
  empId = await addEmployee(nodeId)
})
afterEach(cleanupRbacFixtures)

describe('coverage', () => {
  it('registers employees (25), hierarchy (20), customers (5), sales (11), orgPeople (4), deliveryTeams (5), search (3) and auditLogs.list', () => {
    const keys = Object.keys(accountMappingPolicy)
    const count = (prefix: string) => keys.filter((k) => k.startsWith(prefix)).length
    expect(count('employees.')).toBe(25)
    expect(count('hierarchy.')).toBe(20)
    expect(count('customers.')).toBe(5)
    expect(count('sales.')).toBe(11)
    expect(count('orgPeople.')).toBe(4)
    expect(count('deliveryTeams.')).toBe(5)
    expect(count('search.')).toBe(3)
    expect(keys).toContain('auditLogs.list')
    expect(keys).toHaveLength(74)
  })
})

describe('People & Contacts vs Customer Departments vs Company Org Structure are independent (decision 5)', () => {
  it('Sales may edit contacts and departments but never the company org chart', async () => {
    expect(await denied('sales', 'employees.update', { id: empId, patch: {} })).toBe(false)
    expect(await denied('sales', 'hierarchy.updateNode', { id: nodeId, patch: { name: 'x' } })).toBe(false)
    expect(await denied('sales', 'orgPeople.update', { id: randomUUID(), patch: {} })).toBe(true)
  })
  it('CXO edits the org chart but is only a reader of contacts and departments', async () => {
    expect(await denied('cxo', 'orgPeople.create', {})).toBe(false)
    expect(await denied('cxo', 'employees.update', { id: empId, patch: {} })).toBe(true)
    expect(await denied('cxo', 'hierarchy.updateNode', { id: nodeId, patch: { name: 'x' } })).toBe(true)
  })
  it('deleting contacts or departments is IT-only; a merge counts as a delete', async () => {
    expect(await denied('sales', 'employees.delete', { id: empId })).toBe(true)
    expect(await denied('it', 'employees.delete', { id: empId })).toBe(false)
    expect(await denied('sales', 'employees.merge', {})).toBe(true)
    expect(await denied('it', 'employees.merge', {})).toBe(false) // merge counts as a delete, which IT holds (review finding 5)
    expect(await denied('sales', 'hierarchy.deleteNode', { id: nodeId })).toBe(true)
    expect(await denied('it', 'hierarchy.deleteNode', { id: nodeId })).toBe(false)
  })
  it('re-posting a contact (employees.transfers.transfer) needs BOTH contacts and departments (cross-module)', async () => {
    expect(await denied('sales', 'employees.transfers.transfer', {})).toBe(false)
    expect(await denied('it', 'employees.transfers.transfer', {})).toBe(true)
  })
})

describe('hierarchy: one router, three domains', () => {
  it('createNode / updateNode are judged on the node domain', async () => {
    expect(await denied('it', 'hierarchy.createNode', { domain: 'geo' })).toBe(false)
    expect(await denied('sales', 'hierarchy.createNode', { domain: 'geo' })).toBe(true)
    expect(await denied('sales', 'hierarchy.createNode', { domain: 'org' })).toBe(false)
    expect(await denied('it', 'hierarchy.updateNode', { id: geoId, patch: {} })).toBe(false)
    expect(await denied('sales', 'hierarchy.updateNode', { id: geoId, patch: {} })).toBe(true)
  })
  it('the node TYPE decides the domain, never just the client-supplied one (review finding 4)', async () => {
    // Sales may create departments but not geography: claiming domain 'org' for a geography type must not work
    expect(await denied('sales', 'hierarchy.createNode', { domain: 'org', typeKey: 'district', parentId: geoId })).toBe(true)
    expect(await denied('sales', 'hierarchy.createNode', { domain: 'org', typeKey: 'branch', parentId: geoId })).toBe(true) // org type under a geo parent
    expect(await denied('sales', 'hierarchy.createNode', { domain: 'org', typeKey: 'branch', parentId: nodeId })).toBe(false)
    expect(await denied('sales', 'hierarchy.createNode', { domain: 'org', typeKey: 'no-such-type', parentId: nodeId })).toBe(true)
    expect(await denied('it', 'hierarchy.createNode', { domain: 'geo', typeKey: 'district', parentId: geoId })).toBe(false)
    // moving a node must stay inside its own domain
    expect(await denied('sales', 'hierarchy.moveNode', { id: nodeId, newParentId: geoId })).toBe(true)
    expect(await denied('sales', 'hierarchy.moveNode', { id: nodeId, newParentId: null })).toBe(false)
  })
  it('refuses an unknown domain or a missing node rather than guessing', async () => {
    expect(await denied('cxo', 'hierarchy.createNode', { domain: 'moon' })).toBe(true)
    expect(await denied('cxo', 'hierarchy.deleteNode', { id: randomUUID() })).toBe(true)
  })
  it('reads resolve by domain: a no-role user can read geography but not departments', async () => {
    expect(await denied('nobody', 'hierarchy.listStates')).toBe(false)
    expect(await denied('nobody', 'hierarchy.getNode', { id: geoId })).toBe(false)
    expect(await denied('nobody', 'hierarchy.getNode', { id: nodeId })).toBe(true)
    expect(await denied('nobody', 'hierarchy.listDepartments')).toBe(true)
    expect(await denied('delivery', 'hierarchy.listOrgRoots', { stateCode: 24 })).toBe(false)
  })
})

describe('meetings and the Sales roster (own scope)', () => {
  it('only Sales and read-roles see meetings; Legal, IT and Finance do not', async () => {
    expect(await denied('sales', 'employees.timeline.listAll')).toBe(false)
    for (const label of ['legal', 'it', 'finance']) expect(await denied(label, 'employees.timeline.listAll')).toBe(true)
  })
  const meeting = async (createdBy: string | null, attendees: unknown[] = []) => (await pool.query(
    `INSERT INTO timeline_events (employee_id, type, title, date, created_by, attendees) VALUES ($1,'meeting','m','2026-01-01',$2,$3::jsonb) RETURNING id`,
    [empId, createdBy, JSON.stringify(attendees)],
  )).rows[0].id as string
  const followUp = async (createdBy: string | null, assigneeId: string | null = null) => (await pool.query(
    `INSERT INTO follow_ups (entity_type, entity_id, assignee_id, due_date, status, note, created_by) VALUES ('contact',$1,$2,'2999-01-01','open','',$3) RETURNING id`,
    [empId, assigneeId, createdBy],
  )).rows[0].id as string
  const editMeeting = (id: string) => denied('sales', 'employees.timeline.update', { id, patch: { title: 'x' } })

  it('Sales edits a meeting it created, not someone else (spec §9.1: a recorded creator is the whole definition)', async () => {
    expect(await editMeeting(await meeting(rbacEmail('sales')))).toBe(false)
    expect(await denied('sales', 'employees.timeline.delete', { id: await meeting('rbac-rival@amnex.com') })).toBe(true)
  })
  it('a meeting with a recorded creator is NOT own through attendance or owning the contact', async () => {
    await assignOwner('contact', empId, salesId)
    const theirs = await meeting('rbac-rival@amnex.com', [{ salesPersonId: salesId }])
    expect(await editMeeting(theirs)).toBe(true)
    expect(await denied('sales', 'employees.timeline.delete', { id: theirs })).toBe(true)
  })
  it('only a legacy meeting (no creator) falls back to attendance, then to owning the contact', async () => {
    expect(await editMeeting(await meeting(null))).toBe(true) // nobody linked
    expect(await editMeeting(await meeting(null, [{ salesPersonId: rivalId }]))).toBe(true)
    expect(await editMeeting(await meeting(null, [{ salesPersonId: salesId }]))).toBe(false)
    const unlinked = await meeting(null)
    await assignOwner('contact', empId, salesId)
    expect(await editMeeting(unlinked)).toBe(false)
  })
  it('follow-ups follow the same definition: creator, else (legacy) assignee, else contact owner', async () => {
    const fu = (id: string) => denied('sales', 'followUps.setStatus', { id, status: 'done' })
    expect(await fu(await followUp(rbacEmail('sales')))).toBe(false)
    expect(await fu(await followUp('rbac-rival@amnex.com', salesId))).toBe(true) // assigned to me, but created by someone else
    expect(await fu(await followUp(null, rivalId))).toBe(true)
    expect(await fu(await followUp(null, salesId))).toBe(false) // legacy: assignee
    const legacyUnassigned = await followUp(null)
    expect(await fu(legacyUnassigned)).toBe(true)
    await assignOwner('contact', empId, salesId)
    expect(await fu(legacyUnassigned)).toBe(false) // legacy: owns the contact
    expect(await fu(await followUp('rbac-rival@amnex.com'))).toBe(true) // created by someone else: owning the contact is not enough
    expect(await denied('sales', 'followUps.delete', { id: await followUp('rbac-rival@amnex.com', salesId) })).toBe(true)
  })
  it('Sales edits only its own roster profile fields; CXO edits the roster', async () => {
    expect(await denied('sales', 'sales.update', { id: salesId, patch: { mobile: '1', photoUrl: 'u' } })).toBe(false)
    expect(await denied('sales', 'sales.update', { id: salesId, patch: { officialEmail: 'x@amnex.com' } })).toBe(true)
    expect(await denied('sales', 'sales.update', { id: rivalId, patch: { mobile: '1' } })).toBe(true)
    expect(await denied('cxo', 'sales.update', { id: rivalId, patch: { officialEmail: 'x@amnex.com' } })).toBe(false)
    expect(await denied('sales', 'sales.setStatus', { id: salesId, status: 'inactive' })).toBe(true)
  })
  it('roster names are readable by anyone who can read rows, but personal data is redacted for roles without Sales Team read (gap A4)', async () => {
    expect(await denied('legal', 'sales.listPersons')).toBe(false)
    const person = { id: salesId, name: 'A', officialEmail: 'a@amnex.com', personalEmail: 'p@x', mobile: '9', notes: 'n', photoUrl: null, status: 'active' }
    expect(redactSalesRoster([person], await facts('legal'))).toEqual([expect.objectContaining({ name: 'A', officialEmail: 'a@amnex.com', personalEmail: '', mobile: '', notes: '' })])
    expect(redactSalesRoster([person], await facts('cxo'))).toEqual([person])
  })
})

describe('search and audit masks', () => {
  it('knows a module for every search category (a new category must be classified)', () => {
    for (const c of SEARCH_CATEGORIES) expect(Object.keys(SEARCH_CATEGORY_MODULES), c.key).toContain(c.key)
  })
  it('drops results from modules the caller cannot read, and hides an unknown category', async () => {
    const results = [
      { category: 'employee', id: '1' }, { category: 'meeting', id: '2' }, { category: 'salesPerson', id: '3' }, { category: 'mystery', id: '4' },
    ]
    // Legal reads People & Contacts but is None on Meetings and the Sales Team, and 'mystery' is not a known category
    const legal = filterSearchResults(results, await facts('legal')) as { category: string }[]
    expect(legal.map((r) => r.category)).toEqual(['employee'])
    const cxo = filterSearchResults(results, await facts('cxo')) as { category: string }[]
    expect(cxo.map((r) => r.category).sort()).toEqual(['employee', 'meeting', 'salesPerson'])
  })
  it('search requires being able to read at least something; relationship analytics is Operational analytics', async () => {
    expect(await denied('nobody', 'search.search', { query: 'x' })).toBe(false) // Geography baseline counts
    expect(await denied('sales', 'search.relationshipAnalytics')).toBe(false)
    expect(await denied('nobody', 'search.relationshipAnalytics')).toBe(true)
  })
  it('blanks old/new values of restricted SKU fields in audit entries', async () => {
    const entries = [{ entityType: 'sku', field: 'hardwareCost', oldValue: '1', newValue: '2' }, { entityType: 'sku', field: 'listPrice', oldValue: '1', newValue: '2' }]
    const masked = maskAuditList(entries, await facts('it')) as any[]
    expect(masked[0]).toMatchObject({ oldValue: '', newValue: '', masked: true })
    expect(masked[1]).toMatchObject({ oldValue: '1', newValue: '2' })
    expect(maskAuditList(entries, await facts('finance'))).toEqual(entries)
  })
  it('the global audit feed is for CXO and IT; a scoped query follows the entity module', async () => {
    expect(await denied('cxo', 'auditLogs.list', {})).toBe(false)
    expect(await denied('sales', 'auditLogs.list', {})).toBe(true)
    expect(await denied('sales', 'auditLogs.list', { entityType: 'contact' })).toBe(false)
    expect(await denied('legal', 'auditLogs.list', { entityType: 'sku' })).toBe(true)
    expect(await denied('legal', 'auditLogs.list', { entityType: 'widget' })).toBe(true) // unknown entity types need the global feed
  })
})
