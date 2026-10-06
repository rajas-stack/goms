import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
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
  it('treats a System Admin as unrestricted: W everywhere, every atom editable except the frozen Solution Lead, masked fields readable', () => {
    const { result } = renderHook(() => usePermissions(), { wrapper: wrap({ mode: 'enforce', email: 'root@amnex.com', roles: ['system_admin'], facts }) })
    const anyRow = { salesOwnerIds: [], createdBy: null, assigned: { presales: null, legal: null, bid: null } }
    expect(result.current.level('com.skus')).toBe('W')
    expect(result.current.level('admin.access')).toBe('W')
    expect(result.current.can('com.skus', 'delete')).toBe(true)
    expect(result.current.canEdit('com.skus', 'sku.costs')).toBe(true)
    expect(result.current.canEdit('opp.bidTracker', 'bid.stage', anyRow)).toBe(true)
    expect(result.current.canEdit('am.ownership', 'ownership.solutionLead', anyRow)).toBe(false)
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
