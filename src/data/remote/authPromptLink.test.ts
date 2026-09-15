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

  it('notifies "unauthorized" on a query UNAUTHORIZED error (protected reads, staged behind READ_AUTH_ENFORCEMENT_ENABLED)', () => {
    const spy = vi.spyOn(authPrompt, 'notifyAuthRequired')
    runLinkWithError('UNAUTHORIZED', 'query')
    expect(spy).toHaveBeenCalledWith('unauthorized')
  })

  it('notifies "forbidden" on a query FORBIDDEN error', () => {
    const spy = vi.spyOn(authPrompt, 'notifyAuthRequired')
    runLinkWithError('FORBIDDEN', 'query')
    expect(spy).toHaveBeenCalledWith('forbidden')
  })

  it('does not notify on an unrelated mutation error code', () => {
    const spy = vi.spyOn(authPrompt, 'notifyAuthRequired')
    runLinkWithError('BAD_REQUEST', 'mutation')
    expect(spy).not.toHaveBeenCalled()
  })

  it('does not notify on an unrelated query error code', () => {
    const spy = vi.spyOn(authPrompt, 'notifyAuthRequired')
    runLinkWithError('BAD_REQUEST', 'query')
    expect(spy).not.toHaveBeenCalled()
  })

  it('does not notify on a successful query — a signed-in user loads the app normally', () => {
    const spy = vi.spyOn(authPrompt, 'notifyAuthRequired')
    const link = authPromptLink({} as any)
    const fakeNext = () => observable<{ result: { data: string } }>((observer) => {
      observer.next({ result: { data: 'ok' } })
      observer.complete()
      return () => {}
    })
    let value: unknown
    link({ op: { type: 'query' } as any, next: fakeNext as any }).subscribe({
      next: (v: unknown) => { value = v },
    })
    expect(spy).not.toHaveBeenCalled()
    expect(value).toEqual({ result: { data: 'ok' } })
  })

  it('still propagates the original error to the caller', () => {
    const caught = runLinkWithError('UNAUTHORIZED', 'mutation') as { data?: { code?: string } }
    expect(caught?.data?.code).toBe('UNAUTHORIZED')
  })
})
