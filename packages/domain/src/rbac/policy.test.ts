import { describe, expect, it } from 'vitest'
import { DERIVED_ROLE_DEPARTMENTS, FIELD_SETS, GRANTS, MODULES, SALES_ROLE_STATUSES, grantFor, validatePolicy } from './policy.js'
import { EXCLUSIVE_ATOMS, W_ONLY_ATOMS } from './atoms.js'
import { ROLES } from './types.js'

describe('RBAC policy matrix', () => {
  it('has the 26 spec modules and exactly one derived module (the Master Grid)', () => {
    expect(MODULES).toHaveLength(26)
    expect(MODULES.filter((m) => m.key === 'opp.master')).toHaveLength(1)
    expect(Object.keys(GRANTS)).toHaveLength(25)
    expect(Object.keys(GRANTS)).not.toContain('opp.master')
  })

  it('passes every structural invariant', () => {
    expect(validatePolicy()).toEqual([])
  })

  it('matches representative cells of the approved matrix (spec §10)', () => {
    expect(grantFor('opp.bidTracker', 'sales')).toEqual({ level: 'P', scope: 'own', sets: ['S1'], create: true, delete: false })
    expect(grantFor('opp.bidTracker', 'presales')).toEqual({ level: 'P', scope: 'asg', sets: ['P1'], create: false, delete: false })
    expect(grantFor('opp.bidTracker', 'bid')).toEqual({ level: 'W', scope: 'all', sets: [], create: true, delete: true })
    expect(grantFor('opp.bidTracker', 'cxo')).toEqual({ level: 'P', scope: 'all', sets: ['X1'], create: false, delete: false })
    expect(grantFor('opp.pipeline', 'sales')).toMatchObject({ level: 'W', scope: 'own', create: true, delete: false })
    expect(grantFor('com.skus', 'finance')).toMatchObject({ level: 'P', sets: ['F1'] })
    expect(grantFor('com.approvalMatrix', 'cxo')).toMatchObject({ level: 'W', create: true, delete: true })
    expect(grantFor('com.approvalMatrix', 'finance')).toMatchObject({ level: 'R', create: false, delete: false })
    expect(grantFor('com.boqs', 'cxo')).toMatchObject({ level: 'P', sets: ['X2'] })
    expect(grantFor('am.ownership', 'bid')).toMatchObject({ level: 'P', sets: ['B1'], create: true, delete: true })
    expect(grantFor('am.customers', 'it')).toMatchObject({ level: 'R' })
    expect(grantFor('admin.access', 'it')).toMatchObject({ level: 'W', create: true, delete: true })
  })

  it('gives Delivery read-only grants only — it has no assignment slot to scope writes to', () => {
    for (const grant of Object.values(GRANTS).map((g) => g.delivery)) {
      expect(['N', 'R']).toContain(grant.level)
      expect(grant.scope).toBe('all')
      expect(grant.create || grant.delete).toBe(false)
    }
  })

  it('derives roles only from the four decided departments; Finance, IT and Delivery are override-only', () => {
    expect(DERIVED_ROLE_DEPARTMENTS).toEqual({ presales: 'Pre-Sales', bid: 'Bid Management', legal: 'Legal', cxo: 'Leadership' })
  })

  it('derives Sales only from active and onLeave roster entries (plan gap A6): resigned and inactive do not count', () => {
    expect([...SALES_ROLE_STATUSES]).toEqual(['active', 'onLeave'])
  })

  it('keeps W-only atoms out of every partial set and pins the exclusive-atom list', () => {
    for (const [name, atoms] of Object.entries(FIELD_SETS)) {
      for (const atom of atoms) expect(W_ONLY_ATOMS, `${name} contains ${atom}`).not.toContain(atom)
    }
    expect([...EXCLUSIVE_ATOMS].sort()).toEqual(
      ['boq.approve', 'master.currencies', 'master.taxClasses', 'ownership.solutionLead', 'sku.costs', 'sku.floor', 'sku.tax'],
    )
  })

  it('has a grant for every role in every module', () => {
    for (const module of Object.keys(GRANTS)) for (const role of ROLES) expect(GRANTS[module as keyof typeof GRANTS][role]).toBeDefined()
  })
})
