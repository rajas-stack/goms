import { TRPCError } from '@trpc/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appRouter } from '../../../index.js'
import { ungatedProcedures } from '../../../testHelpers/probeGuard.js'
import { protectedProcedure, protectedReadProcedure, publicProcedure, rbacReadProcedure, router } from '../../../trpc.js'
import { PROCEDURE_POLICY } from './index.js'

const paths = Object.keys((appRouter as any)._def.procedures) as string[]

describe('PROCEDURE_POLICY completeness', () => {
  it('registers every procedure of the real appRouter — a new procedure without a policy fails this test', () => {
    expect(paths.filter((p) => !PROCEDURE_POLICY[p])).toEqual([])
  })
  it('has no entry for a procedure that no longer exists', () => {
    const known = new Set(paths)
    expect(Object.keys(PROCEDURE_POLICY).filter((p) => !known.has(p))).toEqual([])
  })
  it('exempts only the intended procedures', () => {
    const exempt = Object.entries(PROCEDURE_POLICY).filter(([, e]) => e.kind).map(([p, e]) => `${e.kind}:${p}`).sort()
    expect(exempt).toEqual([
      'outside:adminImport.commitGeographyLoad', 'outside:adminImport.history', 'outside:adminImport.listDomains',
      'outside:adminImport.previewGeographyLoad', 'outside:adminImport.session.commit', 'outside:adminImport.session.history',
      'outside:adminImport.session.validate', 'public:health.check', 'self:auth.me',
    ])
  })
  it('gives every non-exempt entry at least one requirement', () => {
    for (const [path, entry] of Object.entries(PROCEDURE_POLICY)) {
      if (!entry.kind) expect(entry.requirements.length, path).toBeGreaterThan(0)
    }
  })
})

describe('cross-module procedures declare every module they touch (spec §9)', () => {
  it.each([
    'bids.update', 'bids.create', 'employees.transfers.transfer',
    'bidMilestones.create', 'bidMilestones.update', 'bidMilestones.delete', 'bidCorrigenda.reviewChange',
  ])('%s has more than one requirement', (path) => {
    expect(PROCEDURE_POLICY[path].requirements.length).toBeGreaterThan(1)
  })
})

describe('every registered procedure is actually mounted on a gated tier', () => {
  beforeEach(() => { process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce'; delete process.env.ADMIN_IMPORT_ENABLED })
  afterEach(() => { delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE })

  const gatedPaths = paths.filter((p) => PROCEDURE_POLICY[p] && !PROCEDURE_POLICY[p].kind)

  it('runs the RBAC gate on every non-exempt procedure of the real appRouter (a registry entry on an ungated tier fails here)', async () => {
    expect(gatedPaths.length).toBeGreaterThan(150)
    const before = { ...PROCEDURE_POLICY }
    expect(await ungatedProcedures(appRouter as any, gatedPaths)).toEqual([])
    expect(PROCEDURE_POLICY).toEqual(before) // the probe restores the registry
  })

  it('keeps every exempt procedure behind its own gate, never open: Admin Data Import is unreachable without its token', async () => {
    const outside = paths.filter((p) => PROCEDURE_POLICY[p]?.kind === 'outside')
    expect(outside.length).toBe(7)
    const caller: any = appRouter.createCaller({ authHeader: undefined })
    for (const path of outside) {
      const call = path.split('.').reduce<any>((n, part) => n[part], caller)
      const err = await call(undefined).catch((e: unknown) => e)
      expect(err, path).toBeInstanceOf(TRPCError)
      expect(['NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN'], path).toContain((err as TRPCError).code)
    }
  })

  describe('the probe itself is sound (it would catch a bypass)', () => {
    const fake = router({
      gated: protectedProcedure.mutation(() => 'ran'),
      gatedRead: protectedReadProcedure.query(() => 'ran'),
      gatedGeo: rbacReadProcedure.query(() => 'ran'),
      forgotten: publicProcedure.query(() => 'ran'), // registered below, but mounted on the ungated tier
      forgottenMutation: publicProcedure.mutation(() => 'ran'),
    })
    const names = ['gated', 'gatedRead', 'gatedGeo', 'forgotten', 'forgottenMutation']
    beforeEach(() => { for (const n of names) PROCEDURE_POLICY[n] = { requirements: [() => ({ module: 'com.skus', action: 'read' })] } })
    afterEach(() => { for (const n of names) delete PROCEDURE_POLICY[n] })

    it('reports exactly the procedures that skip the gate', async () => {
      expect(await ungatedProcedures(fake as any, names)).toEqual(['forgotten', 'forgottenMutation'])
    })
    it('restores the registry entries it replaced', async () => {
      const original = PROCEDURE_POLICY.gated
      await ungatedProcedures(fake as any, names)
      expect(PROCEDURE_POLICY.gated).toBe(original)
    })
    it('reports a procedure with no registry entry at all as not probed-gated', async () => {
      delete PROCEDURE_POLICY.gated
      expect(await ungatedProcedures(fake as any, ['gated'])).toEqual([])
      expect(PROCEDURE_POLICY.gated).toBeUndefined() // and it leaves no entry behind
    })
  })
})
