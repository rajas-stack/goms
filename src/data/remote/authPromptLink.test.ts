import { describe, it, expect, vi, beforeEach } from 'vitest'
import { observable } from '@trpc/server/observable'
import { authPromptLink } from './authPromptLink'
import * as authPrompt from '@/lib/authPrompt'

function runLinkWithError(code: string | undefined, opType: 'query' | 'mutation') {
  const link = authPromptLink({} as any)
  const fakeNext = () => observable((observer) => {
    observer.error({ data: { code } })
    return () => {}
  })
  let caught: unknown
  link({ op: { type: opType } as any, next: fakeNext as any }).subscribe({
    error: (e: unknown) => { caught = e },
  })
  return caught
}

describe('authPromptLink', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('notifies "unauthorized" on a mutation UNAUTHORIZED error', () => {
    const spy = vi.spyOn(authPrompt, 'notifyAuthRequired')
    runLinkWithError('UNAUTHORIZED', 'mutation')
    expect(spy).toHaveBeenCalledWith('unauthorized')
  })

  it('notifies "forbidden" on a mutation FORBIDDEN error', () => {
    const spy = vi.spyOn(authPrompt, 'notifyAuthRequired')
    runLinkWithError('FORBIDDEN', 'mutation')
    expect(spy).toHaveBeenCalledWith('forbidden')
  })

  it('does not notify on a query error', () => {
    const spy = vi.spyOn(authPrompt, 'notifyAuthRequired')
    runLinkWithError('UNAUTHORIZED', 'query')
    expect(spy).not.toHaveBeenCalled()
  })

  it('does not notify on an unrelated mutation error code', () => {
    const spy = vi.spyOn(authPrompt, 'notifyAuthRequired')
    runLinkWithError('BAD_REQUEST', 'mutation')
    expect(spy).not.toHaveBeenCalled()
  })

  it('still propagates the original error to the caller', () => {
    const caught = runLinkWithError('UNAUTHORIZED', 'mutation') as { data?: { code?: string } }
    expect(caught?.data?.code).toBe('UNAUTHORIZED')
  })
})
