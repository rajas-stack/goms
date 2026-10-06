import { TRPCError } from '@trpc/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appRouter } from '../../index.js'
import { contextForEmail } from '../../testHelpers/authTestHelpers.js'
import { addSalesPerson, cleanupRbacFixtures, makeBid, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { decide } from './decide.js'
import { RbacDenial } from './denial.js'
import { filterSearchResults } from './registry/masks.js'
import { loadUserFacts } from './userFacts.js'

/** Keys that exist on every object via Object.prototype. JSON.parse makes them OWN keys of a request body. */
const PROTO_KEYS = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']
const body = (key: string, value: unknown = 1) => JSON.parse(`{"${key}": ${JSON.stringify(value)}}`)
const as = (label: string) => appRouter.createCaller(contextForEmail(rbacEmail(label)))
const code = async (p: Promise<unknown>) => { try { await p; return 'ok' } catch (e) { return e instanceof TRPCError ? `${e.code}${e.cause instanceof RbacDenial ? ':rbac' : ''}` : 'THROWN' } }

beforeEach(async () => {
  await cleanupRbacFixtures()
  await addSalesPerson('sales')
  for (const role of ['bid', 'it', 'cxo', 'finance', 'presales'] as const) await setRole(role, role)
  process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce'
})
afterEach(async () => {
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE
  await cleanupRbacFixtures()
})

describe('patch keys that look like Object.prototype members fail closed with a denial, never a 500', () => {
  it.each(PROTO_KEYS)('opportunities.update / bids.update / skus.update / sales.update / line items with key %s', async (key) => {
    const { opportunityId, bidId } = await makeBid({ withBid: true })
    const user = await loadUserFacts(rbacEmail('bid'))
    const calls: [string, unknown][] = [
      ['opportunities.update', { id: opportunityId, patch: body(key) }],
      ['bids.update', { id: bidId, patch: body(key) }],
      ['commercial.skus.update', { id: 'x', patch: body(key) }],
      ['commercial.boq.updateLineItem', { id: 'x', patch: body(key) }],
      ['sales.update', { id: 'x', patch: body(key) }],
    ]
    for (const [path, raw] of calls) {
      const { denial } = await decide(path, raw, user) // must not throw
      expect(denial, `${path} ${key}`).not.toBeNull()
    }
  })
  it('refuses the same call over the real router with FORBIDDEN, not INTERNAL_SERVER_ERROR', async () => {
    const { opportunityId } = await makeBid({ withBid: false })
    for (const key of PROTO_KEYS) {
      expect(await code(as('bid').opportunities.update({ id: opportunityId, patch: body(key) } as any)), key).toBe('FORBIDDEN:rbac')
    }
  })
})

describe('auditLogs.list with a prototype-style entityType', () => {
  it.each(PROTO_KEYS)('%s is treated as an unknown entity: the global feed, which needs Audit Logs read', async (key) => {
    expect(await code(as('it').auditLogs.list({ entityType: key }))).toBe('ok') // IT reads Audit Logs
    expect(await code(as('cxo').auditLogs.list({ entityType: key }))).toBe('ok')
    expect(await code(as('bid').auditLogs.list({ entityType: key }))).toBe('FORBIDDEN:rbac') // Bid has no admin.audit
    expect(await code(as('bid').commercial.auditLogs.list({ entityType: key }))).toBe('FORBIDDEN:rbac')
  })
  it('a real entity type still follows its own module', async () => {
    expect(await code(as('bid').auditLogs.list({ entityType: 'bid' }))).toBe('ok')
  })
})

describe('search category lookups', () => {
  it.each(PROTO_KEYS)('a result whose category is %s is hidden, not a crash', async (key) => {
    const user = await loadUserFacts(rbacEmail('bid'))
    const out = filterSearchResults({ results: [{ category: key, id: 1 }, { category: 'geography', id: 2 }] }, user) as any
    expect(out.results.map((r: any) => r.id)).toEqual([2])
  })
})
