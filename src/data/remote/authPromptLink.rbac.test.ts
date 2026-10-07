import { describe, expect, it, vi } from 'vitest'
import { observable } from '@trpc/server/observable'

vi.mock('@/lib/authPrompt', () => ({ notifyAuthRequired: vi.fn() }))
import { notifyAuthRequired } from '@/lib/authPrompt'
import { authPromptLink } from './authPromptLink'

function run(error: unknown, path?: string) {
  const link = authPromptLink({} as any)
  const next = () => observable((o) => { o.error(error as any) })
  return new Promise<void>((resolve) => link({ op: { path } as any, next } as any).subscribe({ error: () => resolve() }))
}

describe('authPromptLink', () => {
  it('still opens the sign-in dialog for a genuine FORBIDDEN / UNAUTHORIZED', async () => {
    await run({ data: { code: 'FORBIDDEN' } })
    expect(notifyAuthRequired).toHaveBeenCalledWith('forbidden')
    await run({ data: { code: 'UNAUTHORIZED' } })
    expect(notifyAuthRequired).toHaveBeenCalledWith('unauthorized')
  })
  it('does NOT open it for an RBAC denial (data.rbacDenied)', async () => {
    vi.mocked(notifyAuthRequired).mockClear()
    await run({ data: { code: 'FORBIDDEN', rbacDenied: true } })
    expect(notifyAuthRequired).not.toHaveBeenCalled()
  })
  it('does NOT open it for a plain FORBIDDEN on an access.* path (that screen shows its own message), but still does for UNAUTHORIZED there', async () => {
    vi.mocked(notifyAuthRequired).mockClear()
    await run({ data: { code: 'FORBIDDEN' } }, 'access.readiness')
    await run({ data: { code: 'FORBIDDEN' } }, 'access.setRoleOverride')
    expect(notifyAuthRequired).not.toHaveBeenCalled()
    await run({ data: { code: 'UNAUTHORIZED' } }, 'access.readiness')
    expect(notifyAuthRequired).toHaveBeenCalledWith('unauthorized')
  })
  it('still opens it for a plain FORBIDDEN on any non-access path', async () => {
    vi.mocked(notifyAuthRequired).mockClear()
    await run({ data: { code: 'FORBIDDEN' } }, 'pipeline.update')
    await run({ data: { code: 'FORBIDDEN' } }, 'accessories.list') // only the `access.` namespace is exempt
    expect(notifyAuthRequired).toHaveBeenCalledTimes(2)
    expect(notifyAuthRequired).toHaveBeenCalledWith('forbidden')
  })
})
