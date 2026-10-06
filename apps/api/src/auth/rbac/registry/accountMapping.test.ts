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
  it('Sales edits a meeting it created or attends or whose contact it owns, not someone else\'s', async () => {
    const mine = (await pool.query(
      `INSERT INTO timeline_events (employee_id, type, title, date, created_by) VALUES ($1,'meeting','m','2026-01-01',$2) RETURNING id`, [empId, rbacEmail('sales')],
    )).rows[0].id
    const theirs = (await pool.query(
      `INSERT INTO timeline_events (employee_id, type, title, date, created_by) VALUES ($1,'meeting','m','2026-01-01','rbac-rival@amnex.com') RETURNING id`, [empId],
    )).rows[0].id
    expect(await denied('sales', 'employees.timeline.update', { id: mine, patch: { title: 'x' } })).toBe(false)
    expect(await denied('sales', 'employees.timeline.update', { id: theirs, patch: { title: 'x' } })).toBe(true)
    expect(await denied('sales', 'employees.timeline.delete', { id: theirs })).toBe(true)
    await assignOwner('contact', empId, salesId)
    expect(await denied('sales', 'employees.timeline.update', { id: theirs, patch: { title: 'x' } })).toBe(false) // now owns the contact
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
