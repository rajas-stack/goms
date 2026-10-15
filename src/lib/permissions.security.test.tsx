import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
vi.mock('./api', () => ({ useMyAccess: () => ({ data: undefined }) }))
import { PermissionsProvider, usePermissions } from './permissions'
afterEach(() => vi.unstubAllEnvs())
describe('permission loading security', () => {
  it('fails closed while remote permissions are unavailable', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://goms.example.com')
    const { result } = renderHook(usePermissions, { wrapper: ({ children }) => <PermissionsProvider>{children}</PermissionsProvider> })
    expect(result.current.enforced).toBe(true)
    expect(result.current.can('admin.access', 'delete')).toBe(false)
    expect(result.current.level('opp.bidTracker')).toBe('N')
  })
})
