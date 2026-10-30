import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONNECTION_CHECK_MS, isNetworkError, useMailConnection } from './useMailConnection'

describe('isNetworkError', () => {
  it('tells a request that never arrived from an answer the server gave', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new Error('NetworkError when attempting to fetch resource.'))).toBe(true)
    expect(isNetworkError(new Error('Unexpected status 502 Bad Gateway'))).toBe(true)
    expect(isNetworkError(new Error('You do not have access to this mailbox.'))).toBe(false)
    expect(isNetworkError(null)).toBe(false)
  })
})

describe('useMailConnection', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('goes offline when the 30 s check fails and refetches the mailbox when it is back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useMailConnection('me@amnex.com'), { wrapper })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(result.current.online).toBe(true)

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await act(async () => { await vi.advanceTimersByTimeAsync(CONNECTION_CHECK_MS) })
    expect(result.current.online).toBe(false)
    expect(invalidate).not.toHaveBeenCalled()

    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(CONNECTION_CHECK_MS) })
    expect(result.current.online).toBe(true)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['emailCenter', 'me@amnex.com'] })
  })

  it('reacts to the browser going offline at once', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useMailConnection('me@amnex.com'), { wrapper })
    await waitFor(() => expect(result.current.online).toBe(true))
    act(() => { window.dispatchEvent(new Event('offline')) })
    expect(result.current.online).toBe(false)
  })
})
