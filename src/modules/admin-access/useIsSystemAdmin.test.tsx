import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { PermissionsProvider } from '@/lib/permissions'
import { useIsSystemAdmin, useSystemAdminStatus } from './useIsSystemAdmin'

const facts = { salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } }
const wrap = (access: any) => ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PermissionsProvider access={access}>{children}</PermissionsProvider>
  </QueryClientProvider>
)
const me = (mode: 'off' | 'shadow' | 'enforce', roles: string[]) => ({ mode, email: mode === 'off' ? null : 'x@amnex.com', roles, facts: mode === 'off' ? null : facts })

describe('useIsSystemAdmin (UX only: the server decides every write)', () => {
  it.each(['enforce', 'shadow'] as const)('is true in %s when the server reported System Admin among the caller\'s roles', (mode) => {
    const { result } = renderHook(() => useIsSystemAdmin(), { wrapper: wrap(me(mode, ['system_admin'])) })
    expect(result.current).toBe(true)
  })
  it.each(['enforce', 'shadow'] as const)('is false in %s for IT and CXO, and the status is a definite "no"', (mode) => {
    for (const role of ['it', 'cxo']) {
      const { result } = renderHook(() => ({ is: useIsSystemAdmin(), status: useSystemAdminStatus() }), { wrapper: wrap(me(mode, [role])) })
      expect(result.current).toEqual({ is: false, status: 'no' })
    }
  })
  it('with RBAC off the roles are not reported: a successful readiness read (an allow-list gate on the server) means System Admin', () => {
    const yes = renderHook(() => useIsSystemAdmin(true), { wrapper: wrap(me('off', [])) })
    expect(yes.result.current).toBe(true)
    const notYet = renderHook(() => ({ is: useIsSystemAdmin(), status: useSystemAdminStatus() }), { wrapper: wrap(me('off', [])) })
    expect(notYet.result.current).toEqual({ is: false, status: 'unknown' })
  })
  it('a successful readiness read never makes IT a System Admin once the server has reported roles (IT can read it in shadow / enforce)', () => {
    for (const mode of ['enforce', 'shadow'] as const) {
      const { result } = renderHook(() => useIsSystemAdmin(true), { wrapper: wrap(me(mode, ['it'])) })
      expect(result.current).toBe(false)
    }
  })
  it('is false and unknown until auth.me has answered', () => {
    const { result } = renderHook(() => ({ is: useIsSystemAdmin(true), status: useSystemAdminStatus(true) }), { wrapper: wrap(undefined) })
    expect(result.current).toEqual({ is: false, status: 'unknown' })
  })
})
