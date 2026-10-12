// RBAC must be BLIND to which kind of token carried the email: same roles, same decisions, same masks.
import { TRPCError } from '@trpc/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appRouter } from '../../index.js'
import { contextForEmail } from '../../testHelpers/authTestHelpers.js'
import { clearOauthEnv, gomsContextForEmail, useOauthEnv } from '../../testHelpers/oauthTestHelpers.js'
import { addSalesPerson, cleanupRbacFixtures, makeBid, makeSystemAdmin, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { RbacDenial } from '../rbac/denial.js'

const callers = async (label: string) => ({
  firebase: appRouter.createCaller(contextForEmail(rbacEmail(label))),
  goms: appRouter.createCaller(await gomsContextForEmail(rbacEmail(label))),
})
const outcome = async (p: Promise<unknown>) => p.then(() => 'allowed', (e) => (e instanceof TRPCError ? `${e.code}${e.cause instanceof RbacDenial ? ':rbac' : ''}` : 'thrown'))

beforeEach(async () => {
  await cleanupRbacFixtures()
  useOauthEnv('both')
  process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce'
  await addSalesPerson('sales'); await setRole('legal', 'legal'); await setRole('it', 'it'); makeSystemAdmin('root')
})
afterEach(async () => {
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE; delete process.env.ADMIN_ALLOWED_EMAILS
  clearOauthEnv(); await cleanupRbacFixtures()
})

describe('RBAC enforce: a Firebase token and a GOMS token for the same email get the same answer', () => {
  it.each(['sales', 'legal', 'it', 'root', 'nobody'])('%s', async (label) => {
    const { opportunityId } = await makeBid({ withBid: false })
    const { firebase, goms } = await callers(label)
    for (const call of [
      (c: typeof firebase) => c.bids.listForGrid(),
      (c: typeof firebase) => c.opportunities.update({ id: opportunityId, patch: { city: 'Pune' } }),
      (c: typeof firebase) => c.access.listOverrides(),
      (c: typeof firebase) => c.auth.me(),
    ]) {
      expect(await outcome(call(goms)), label).toBe(await outcome(call(firebase)))
    }
  })
  it('auth.me reports identical roles and facts for both token kinds', async () => {
    const { firebase, goms } = await callers('legal')
    expect(await goms.auth.me()).toEqual(await firebase.auth.me())
    expect((await goms.auth.me()).roles).toEqual(['legal'])
  })
  it('a GOMS token for a non-@amnex.com email is still refused by the existing domain gate', async () => {
    const ctx = await gomsContextForEmail('person@gmail.com')
    expect(await outcome(appRouter.createCaller(ctx).bids.listForGrid())).toBe('FORBIDDEN')
  })
  it('System Admin membership still comes only from ADMIN_ALLOWED_EMAILS (a token cannot claim it)', async () => {
    const { goms } = await callers('legal')
    expect((await goms.auth.me()).roles).not.toContain('system_admin')
    expect((await (await callers('root')).goms.auth.me()).roles).toEqual(['system_admin'])
  })
})
