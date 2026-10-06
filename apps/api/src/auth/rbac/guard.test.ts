import { TRPCError } from '@trpc/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatError, protectedProcedure, protectedReadProcedure, rbacReadProcedure, router } from '../../trpc.js'
import { contextForEmail } from '../../testHelpers/authTestHelpers.js'
import { addSalesPerson, cleanupRbacFixtures, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { RbacDenial } from './denial.js'
import { read, write } from './registry/helpers.js'
import { PROCEDURE_POLICY } from './registry/index.js'

const testRouter = router({
  open: protectedProcedure.mutation(() => 'ok'),
  both: protectedProcedure.mutation(() => 'both'),
  unregistered: protectedProcedure.query(() => 'nope'),
  reader: protectedReadProcedure.query(() => 'rows'),
  geo: rbacReadProcedure.query(() => 'geo'),
  masked: protectedReadProcedure.query(() => ({ secret: 1, shown: 2 })),
})

const enforce = (mode: 'shadow' | 'enforce' = 'enforce') => { process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = mode }
const as = (label: string) => testRouter.createCaller(contextForEmail(rbacEmail(label)))

beforeEach(async () => {
  await cleanupRbacFixtures()
  PROCEDURE_POLICY.open = { requirements: [write('opp.bidTracker')] } // a generic write needs W
  PROCEDURE_POLICY.both = { requirements: [write('opp.bidTracker'), write('am.departments')] } // cross-module: every one must pass
  PROCEDURE_POLICY.reader = { requirements: [read('com.skus')] }
  PROCEDURE_POLICY.geo = { requirements: [read('am.geography')] }
  PROCEDURE_POLICY.masked = { requirements: [read('com.skus')], mask: (d) => ({ ...(d as object), secret: null }) }
})
afterEach(async () => {
  for (const k of ['open', 'both', 'unregistered', 'reader', 'geo', 'masked']) delete PROCEDURE_POLICY[k]
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE; delete process.env.READ_AUTH_ENFORCEMENT_ENABLED
  vi.restoreAllMocks()
  await cleanupRbacFixtures()
})

describe('mode off (the deployed default)', () => {
  it('is an exact no-op: even an unregistered procedure runs, with no identity at all', async () => {
    await expect(testRouter.createCaller({}).unregistered()).resolves.toBe('nope')
    await expect(testRouter.createCaller({}).open()).resolves.toBe('ok')
  })
  it('stays off if RBAC_MODE is set but auth is not enforced', async () => {
    process.env.RBAC_MODE = 'enforce'
    await expect(testRouter.createCaller({}).open()).resolves.toBe('ok')
  })
  it('does not apply response masks', async () => {
    await expect(testRouter.createCaller({}).masked()).resolves.toEqual({ secret: 1, shown: 2 })
  })
})

describe('mode enforce', () => {
  beforeEach(() => enforce())

  it('fails closed on a procedure with no registry entry', async () => {
    await setRole('bidder', 'bid')
    const err = await as('bidder').unregistered().catch((e) => e)
    expect(err).toBeInstanceOf(TRPCError)
    expect(err.code).toBe('FORBIDDEN')
    expect(err.cause).toBeInstanceOf(RbacDenial)
    expect(err.message).toMatch(/No access policy is registered/)
  })
  it('allows a role with the level and denies one without, with an RbacDenial cause', async () => {
    await setRole('bidder', 'bid')
    await setRole('lawyer', 'legal')
    await expect(as('bidder').open()).resolves.toBe('ok')
    const err = await as('lawyer').open().catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(err.cause).toBeInstanceOf(RbacDenial)
    expect(err.message).toMatch(/permission to edit Bid Tracker rows/)
  })
  it('a cross-module procedure needs EVERY requirement (never just one module)', async () => {
    await setRole('bidder', 'bid')              // W on Bid Tracker rows, but only R on Customer Departments
    await setRole('both', 'bid'); await setRole('both', 'sales'); await addSalesPerson('both')
    await expect(as('bidder').both()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(as('both').both()).resolves.toBe('both') // Bid W on rows + Sales W on departments
  })
  it('gives a user with no role the Geography baseline and nothing else', async () => {
    await expect(as('nobody').geo()).resolves.toBe('geo')
    await expect(as('nobody').reader()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
  it('applies the entry mask to the response', async () => {
    await setRole('pre', 'presales')
    await expect(as('pre').masked()).resolves.toEqual({ secret: null, shown: 2 })
  })
  it('evaluates calls independently (one denied call does not poison its neighbours)', async () => {
    await setRole('bidder', 'bid')
    await setRole('lawyer', 'legal')
    const [a, b, c] = await Promise.allSettled([as('bidder').open(), as('lawyer').open(), as('bidder').geo()])
    expect(a.status).toBe('fulfilled')
    expect(b.status).toBe('rejected')
    expect(c.status).toBe('fulfilled')
  })
  it('rejects a signed-out call to a gated read with UNAUTHORIZED, not an RBAC denial (Review Focus 4)', async () => {
    const err = await testRouter.createCaller({}).geo().catch((e) => e)
    expect(err.code).toBe('UNAUTHORIZED')
    expect(err.cause).not.toBeInstanceOf(RbacDenial)
  })
  it('keeps the existing non-Amnex rejection, which is not an RBAC denial', async () => {
    const err = await testRouter.createCaller(contextForEmail('someone@gmail.com')).geo().catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(err.cause).not.toBeInstanceOf(RbacDenial)
  })
  it('works for protectedReadProcedure even when READ_AUTH is off (RBAC resolves the caller itself)', async () => {
    await setRole('pre', 'presales')
    await expect(as('pre').reader()).resolves.toBe('rows')
  })
})

describe('mode shadow', () => {
  it('does not apply response masks — shadow blocks and changes nothing (review finding 2)', async () => {
    enforce('shadow')
    await setRole('pre', 'presales')
    await setRole('sales', 'sales')
    await addSalesPerson('sales')
    await expect(as('sales').masked()).resolves.toEqual({ secret: 1, shown: 2 })
  })
  it('logs a would-be denial as JSON and lets the call through', async () => {
    enforce('shadow')
    await setRole('lawyer', 'legal')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(as('lawyer').open()).resolves.toBe('ok')
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('rbac.would_deny'))!
    expect(JSON.parse(line)).toMatchObject({ event: 'rbac.would_deny', path: 'open', email: rbacEmail('lawyer'), module: 'opp.bidTracker', action: 'update' })
  })
  it('logs an unregistered procedure too, and an unauthenticated caller', async () => {
    enforce('shadow')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(testRouter.createCaller({}).geo()).resolves.toBe('geo')
    await setRole('bidder', 'bid')
    await expect(as('bidder').unregistered()).resolves.toBe('nope')
    const lines = log.mock.calls.map((c) => String(c[0]))
    expect(lines.some((l) => l.includes('"path":"geo"') && l.includes('unauthenticated'))).toBe(true)
    expect(lines.some((l) => l.includes('"path":"unregistered"'))).toBe(true)
  })
})

describe('formatError', () => {
  const shape = { message: 'm', code: -32003, data: { code: 'FORBIDDEN', httpStatus: 403 } }
  it('marks an RBAC denial so the client does not show the sign-in dialog', () => {
    const error = new TRPCError({ code: 'FORBIDDEN', cause: new RbacDenial('x', { module: 'm', action: 'a' }) })
    expect((formatError({ shape, error }) as any).data.rbacDenied).toBe(true)
  })
  it('leaves an ordinary FORBIDDEN unmarked and still masks internal errors', () => {
    expect((formatError({ shape, error: new TRPCError({ code: 'FORBIDDEN' }) }) as any).data.rbacDenied).toBeUndefined()
    expect(formatError({ shape, error: new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'boom' }) }).message).toBe('Internal server error')
  })
})
