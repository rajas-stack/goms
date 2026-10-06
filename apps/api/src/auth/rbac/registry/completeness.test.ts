import { describe, expect, it } from 'vitest'
import { appRouter } from '../../../index.js'
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
    'bids.update', 'bids.create', 'employees.transfers.transfer', 'employees.merge',
    'bidMilestones.create', 'bidMilestones.update', 'bidMilestones.delete', 'bidCorrigenda.reviewChange',
  ])('%s has more than one requirement', (path) => {
    expect(PROCEDURE_POLICY[path].requirements.length).toBeGreaterThan(1)
  })
})
