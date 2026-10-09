import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { GRANTS, type Level, type PolicyModuleKey, type Role } from '@goms/domain'
import { readStoredRole, writeStoredRole } from './activeRole'
import { PermissionsProvider, useAllowed, usePermissions } from './permissions'

const wrap = (access: any) => ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PermissionsProvider access={access}>{children}</PermissionsProvider>
  </QueryClientProvider>
)
const facts = { salesPersonId: 'sp1', teamMemberIds: { presales: [], legal: [], bid: [] } }

describe('usePermissions', () => {
  it('allows everything when RBAC is off or unknown (today\'s behavior)', () => {
    for (const access of [undefined, { mode: 'off', email: null, roles: [], facts: null }]) {
      const { result } = renderHook(() => usePermissions(), { wrapper: wrap(access) })
      expect(result.current.enforced).toBe(false)
      expect(result.current.level('com.skus')).toBe('W')
      expect(result.current.can('com.skus', 'delete')).toBe(true)
      expect(result.current.canEdit('opp.bidTracker', 'bid.stage')).toBe(true)
      expect(result.current.canReadAtom('sku.costs')).toBe(true)
    }
  })
  it('treats shadow like off: it only logs on the server, so the UI must hide nothing (review finding 2)', () => {
    const { result } = renderHook(() => usePermissions(), { wrapper: wrap({ mode: 'shadow', email: 's@amnex.com', roles: [], facts }) })
    expect(result.current.enforced).toBe(false)
    expect(result.current.level('com.approvalMatrix')).toBe('W')
  })
  it('evaluates the shared policy for a Sales user, row by row', () => {
    const { result } = renderHook(() => usePermissions(), { wrapper: wrap({ mode: 'enforce', email: 's@amnex.com', roles: ['sales'], facts }) })
    const own = { salesOwnerIds: ['sp1'], createdBy: null, assigned: { presales: null, legal: null, bid: null } }
    const other = { ...own, salesOwnerIds: ['sp9'] }
    expect(result.current.canEdit('opp.pipeline', 'opp.value', own)).toBe(true)
    expect(result.current.canEdit('opp.pipeline', 'opp.value', other)).toBe(false)
    expect(result.current.canEdit('opp.bidTracker', 'bid.stage', own)).toBe(false)
    expect(result.current.level('com.approvalMatrix')).toBe('N')
    expect(result.current.canReadAtom('sku.costs')).toBe(false)
  })
  it('treats a System Admin as unrestricted: W everywhere, every atom editable including Solution Lead, create/delete everywhere, masked fields readable', () => {
    const { result } = renderHook(() => usePermissions(), { wrapper: wrap({ mode: 'enforce', email: 'root@amnex.com', roles: ['system_admin'], facts }) })
    const anyRow = { salesOwnerIds: [], createdBy: null, assigned: { presales: null, legal: null, bid: null } }
    expect(result.current.level('com.skus')).toBe('W')
    expect(result.current.level('admin.access')).toBe('W')
    expect(result.current.can('com.skus', 'delete')).toBe(true)
    expect(result.current.canEdit('com.skus', 'sku.costs')).toBe(true)
    expect(result.current.canEdit('opp.bidTracker', 'bid.stage', anyRow)).toBe(true)
    expect(result.current.canEdit('am.ownership', 'ownership.solutionLead', anyRow)).toBe(true)
    expect(result.current.can('admin.audit', 'delete')).toBe(true)
    expect(result.current.can('an.financial', 'create')).toBe(true)
    expect(result.current.canReadAtom('sku.costs')).toBe(true)
  })
  it('mayWrite says whether the role could edit the module on SOME row (for screens that do not know the row)', () => {
    const sales = renderHook(() => usePermissions(), { wrapper: wrap({ mode: 'enforce', email: 's@amnex.com', roles: ['sales'], facts }) }).result.current
    expect(sales.mayWrite('opp.pipeline')).toBe(true) // W on its own rows
    expect(sales.mayWrite('opp.campaign')).toBe(true)
    expect(sales.mayWrite('com.skus')).toBe(false)
    const legal = renderHook(() => usePermissions(), { wrapper: wrap({ mode: 'enforce', email: 'l@amnex.com', roles: ['legal'], facts }) }).result.current
    expect(legal.mayWrite('am.contacts')).toBe(false)
    const off = renderHook(() => usePermissions(), { wrapper: wrap(undefined) }).result.current
    expect(off.mayWrite('com.skus')).toBe(true)
  })
})

describe('useAllowed', () => {
  const allowedFor = (roles: any[], ...args: Parameters<typeof useAllowed>) =>
    renderHook(() => useAllowed(...args), { wrapper: wrap({ mode: 'enforce', email: 'u@amnex.com', roles, facts }) }).result.current
  it('is true for everyone when RBAC is off', () => {
    expect(renderHook(() => useAllowed('com.skus', 'delete'), { wrapper: wrap(undefined) }).result.current).toBe(true)
  })
  it('create, update and delete follow the module grant', () => {
    expect(allowedFor(['sales'], 'am.contacts', 'update')).toBe(true)
    expect(allowedFor(['sales'], 'am.contacts', 'delete')).toBe(false)
    expect(allowedFor(['it'], 'am.contacts', 'delete')).toBe(true)
    expect(allowedFor(['legal'], 'am.contacts', 'create')).toBe(false)
    expect(allowedFor(['system_admin'], 'admin.access', 'delete')).toBe(true)
  })
  it('an atom narrows an update to that field', () => {
    expect(allowedFor(['sales'], 'team.sales', 'update')).toBe(false)
    expect(allowedFor(['sales'], 'team.sales', 'update', 'sales.ownProfile', { salesOwnerIds: ['sp1'], createdBy: null, assigned: { presales: null, legal: null, bid: null } })).toBe(true)
  })
})

describe('active role (UI narrowing only; the server stays authoritative)', () => {
  const access = (roles: string[], email = 'multi@amnex.com') => ({ mode: 'enforce', email, roles, facts })
  const perms = (a: unknown) => renderHook(() => usePermissions(), { wrapper: wrap(a) }).result.current
  const RANK: Record<Level, number> = { N: 0, R: 1, P: 2, W: 3 }
  const modules = Object.keys(GRANTS) as PolicyModuleKey[]

  beforeEach(() => localStorage.clear())

  it('defaults to "All my roles": the multi-role union, exactly as before', () => {
    const p = perms(access(['sales', 'legal']))
    expect(p.activeRole).toBeNull()
    expect(p.roles).toEqual(['sales', 'legal'])
    expect(p.allRoles).toEqual(['sales', 'legal'])
  })

  it('narrows to exactly the selected role: same answers as a user who only holds that role', () => {
    writeStoredRole('multi@amnex.com', 'sales')
    const narrowed = perms(access(['sales', 'finance']))
    const onlySales = perms(access(['sales'], 'sales-only@amnex.com'))
    expect(narrowed.activeRole).toBe('sales')
    expect(narrowed.roles).toEqual(['sales'])
    expect(narrowed.allRoles).toEqual(['sales', 'finance'])
    for (const m of modules) expect(narrowed.level(m)).toBe(onlySales.level(m))
    expect(narrowed.canReadAtom('sku.costs')).toBe(onlySales.canReadAtom('sku.costs'))
  })

  it('never grants beyond the union of the roles the server reported', () => {
    const roles: Role[] = ['sales', 'legal', 'finance']
    const union = perms(access(roles))
    for (const r of roles) {
      localStorage.clear()
      writeStoredRole('multi@amnex.com', r)
      const narrowed = perms(access(roles))
      expect(narrowed.roles).toEqual([r])
      for (const m of modules) expect(RANK[narrowed.level(m)]).toBeLessThanOrEqual(RANK[union.level(m)])
      for (const atom of ['sku.costs', 'sku.floor'] as const) {
        if (narrowed.canReadAtom(atom)) expect(union.canReadAtom(atom)).toBe(true)
      }
    }
  })

  it('cannot select a role the server does not report: the saved value is ignored and discarded', () => {
    writeStoredRole('multi@amnex.com', 'system_admin')
    const p = perms(access(['sales', 'legal']))
    expect(p.activeRole).toBeNull()
    expect(p.roles).toEqual(['sales', 'legal'])
    expect(p.level('com.skus')).not.toBe('W')
    expect(readStoredRole('multi@amnex.com')).toBeNull()
  })

  it('a mounted provider with a stale role list does not wipe a selection another tab validly made (cleanup runs once at load)', () => {
    const stale = renderHook(() => usePermissions(), { wrapper: wrap(access(['sales', 'legal'])) }) // an older tab: does not know "finance"
    const fresh = renderHook(() => usePermissions(), { wrapper: wrap(access(['sales', 'legal', 'finance'])) })
    act(() => fresh.result.current.setActiveRole('finance')) // the other tab picks a role the server now reports
    expect(readStoredRole('multi@amnex.com')).toBe('finance') // the stale tab must not erase it
    expect(fresh.result.current.activeRole).toBe('finance')
    expect(stale.result.current.activeRole).toBeNull() // and it still never honours a role it does not know
    stale.unmount()
    fresh.unmount()
  })

  it('ignores a saved role for a user with one role or none', () => {
    writeStoredRole('one@amnex.com', 'sales')
    expect(perms(access(['sales'], 'one@amnex.com')).activeRole).toBeNull()
    writeStoredRole('none@amnex.com', 'sales')
    expect(perms(access([], 'none@amnex.com')).roles).toEqual([])
  })

  it('keeps System Admin unrestricted under "All my roles"; selecting System Admin stays unrestricted', () => {
    const all = perms(access(['sales', 'system_admin'], 'admin@amnex.com'))
    expect(all.level('com.skus')).toBe('W')
    expect(all.canReadAtom('sku.costs')).toBe(true)
    writeStoredRole('admin@amnex.com', 'system_admin')
    const asAdmin = perms(access(['sales', 'system_admin'], 'admin@amnex.com'))
    expect(asAdmin.roles).toEqual(['system_admin'])
    expect(asAdmin.level('com.skus')).toBe('W')
  })

  it('setActiveRole persists the choice per user and flips the effective roles', () => {
    const { result } = renderHook(() => usePermissions(), { wrapper: wrap(access(['sales', 'legal'])) })
    act(() => result.current.setActiveRole('legal'))
    expect(result.current.activeRole).toBe('legal')
    expect(result.current.roles).toEqual(['legal'])
    expect(readStoredRole('multi@amnex.com')).toBe('legal')
    act(() => result.current.setActiveRole(null))
    expect(result.current.roles).toEqual(['sales', 'legal'])
    expect(readStoredRole('multi@amnex.com')).toBeNull()
  })

  it('does nothing while RBAC is off or shadow: everything stays visible and there is no role list', () => {
    writeStoredRole('multi@amnex.com', 'sales')
    for (const mode of ['off', 'shadow']) {
      const p = perms({ mode, email: 'multi@amnex.com', roles: ['sales', 'legal'], facts })
      expect(p.activeRole).toBeNull()
      expect(p.allRoles).toEqual([])
      expect(p.level('com.skus')).toBe('W')
    }
  })
})
