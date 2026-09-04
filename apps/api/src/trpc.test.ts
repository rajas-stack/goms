import { afterEach, describe, expect, it } from 'vitest'
import { router, protectedProcedure, adminProcedure } from './trpc.js'
import { contextForEmail } from './testHelpers/authTestHelpers.js'

const testRouter = router({
  ping: protectedProcedure.mutation(() => 'pong'),
  pingAdmin: adminProcedure.mutation(() => 'admin-pong'),
})

function clearEnv() {
  delete process.env.EMERGENCY_READ_ONLY
  delete process.env.AUTH_ENFORCEMENT_ENABLED
  delete process.env.ADMIN_ALLOWED_EMAILS
}

describe('protectedProcedure', () => {
  afterEach(clearEnv)

  it('allows a call through with no identity when enforcement is off (deliberate no-op default)', async () => {
    const caller = testRouter.createCaller({})
    await expect(caller.ping()).resolves.toBe('pong')
  })

  it('blocks every mutation when EMERGENCY_READ_ONLY is on, even with enforcement off', async () => {
    process.env.EMERGENCY_READ_ONLY = 'true'
    const caller = testRouter.createCaller({})
    await expect(caller.ping()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects an unauthenticated call once enforcement is on', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    const caller = testRouter.createCaller({})
    await expect(caller.ping()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('rejects a verified non-Amnex Google account once enforcement is on', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    const caller = testRouter.createCaller(contextForEmail('someone@gmail.com'))
    await expect(caller.ping()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('allows a verified @amnex.com account once enforcement is on', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    const caller = testRouter.createCaller(contextForEmail('someone@amnex.com'))
    await expect(caller.ping()).resolves.toBe('pong')
  })

  it('EMERGENCY_READ_ONLY still blocks a valid @amnex.com caller once enforcement is on', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    process.env.EMERGENCY_READ_ONLY = 'true'
    const caller = testRouter.createCaller(contextForEmail('someone@amnex.com'))
    await expect(caller.ping()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('adminProcedure', () => {
  afterEach(clearEnv)

  it('is a no-op (allows through) when enforcement is off, matching protectedProcedure', async () => {
    const caller = testRouter.createCaller({})
    await expect(caller.pingAdmin()).resolves.toBe('admin-pong')
  })

  it('rejects an @amnex.com account not on ADMIN_ALLOWED_EMAILS once enforcement is on', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    process.env.ADMIN_ALLOWED_EMAILS = 'admin@amnex.com'
    const caller = testRouter.createCaller(contextForEmail('someone@amnex.com'))
    await expect(caller.pingAdmin()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('allows an account on ADMIN_ALLOWED_EMAILS once enforcement is on', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    process.env.ADMIN_ALLOWED_EMAILS = 'admin@amnex.com'
    const caller = testRouter.createCaller(contextForEmail('admin@amnex.com'))
    await expect(caller.pingAdmin()).resolves.toBe('admin-pong')
  })
})
