import { afterEach, describe, expect, it } from 'vitest'
import { router, protectedProcedure, protectedReadProcedure, adminProcedure } from './trpc.js'
import { contextForEmail } from './testHelpers/authTestHelpers.js'

const testRouter = router({
  ping: protectedProcedure.mutation(() => 'pong'),
  pingQuery: protectedProcedure.query(() => 'pong'),
  pingAdmin: adminProcedure.mutation(() => 'admin-pong'),
  pingProtectedRead: protectedReadProcedure.query(() => 'read-pong'),
})

function clearEnv() {
  delete process.env.EMERGENCY_READ_ONLY
  delete process.env.AUTH_ENFORCEMENT_ENABLED
  delete process.env.ADMIN_ALLOWED_EMAILS
  delete process.env.READ_AUTH_ENFORCEMENT_ENABLED
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

  it('does NOT block a query when EMERGENCY_READ_ONLY is on — reads keep working (decision doc §5)', async () => {
    process.env.EMERGENCY_READ_ONLY = 'true'
    const caller = testRouter.createCaller({})
    await expect(caller.pingQuery()).resolves.toBe('pong')
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

describe('protectedReadProcedure', () => {
  afterEach(clearEnv)

  it('allows an unauthenticated read through when READ_AUTH_ENFORCEMENT_ENABLED is unset (deliberate no-op default)', async () => {
    const caller = testRouter.createCaller({})
    await expect(caller.pingProtectedRead()).resolves.toBe('read-pong')
  })

  it('still allows an unauthenticated read even when the unrelated AUTH_ENFORCEMENT_ENABLED (mutation) flag is on', async () => {
    // The two flags are independent by design — sharing one would make
    // converting a read to this procedure an immediate behavior change in
    // goms-prod, where AUTH_ENFORCEMENT_ENABLED is already "true" today.
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    const caller = testRouter.createCaller({})
    await expect(caller.pingProtectedRead()).resolves.toBe('read-pong')
  })

  it('is not blocked by EMERGENCY_READ_ONLY — reads keep working, same as protectedProcedure', async () => {
    process.env.EMERGENCY_READ_ONLY = 'true'
    process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
    const caller = testRouter.createCaller(contextForEmail('someone@amnex.com'))
    await expect(caller.pingProtectedRead()).resolves.toBe('read-pong')
  })

  it('rejects an unauthenticated read once READ_AUTH_ENFORCEMENT_ENABLED is on', async () => {
    process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
    const caller = testRouter.createCaller({})
    await expect(caller.pingProtectedRead()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('rejects a verified non-Amnex Google account once READ_AUTH_ENFORCEMENT_ENABLED is on', async () => {
    process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
    const caller = testRouter.createCaller(contextForEmail('someone@gmail.com'))
    await expect(caller.pingProtectedRead()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('allows a verified @amnex.com account once READ_AUTH_ENFORCEMENT_ENABLED is on', async () => {
    process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
    const caller = testRouter.createCaller(contextForEmail('someone@amnex.com'))
    await expect(caller.pingProtectedRead()).resolves.toBe('read-pong')
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
