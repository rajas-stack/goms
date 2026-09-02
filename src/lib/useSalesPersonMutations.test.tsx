import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSalesPersonMutations } from './api'
import { repository, resetLocalData } from '@/data/repository'

// 2026-09-02, task 6.2. `updatePostingManager` must invalidate the same
// query keys as the existing `transfer`/`update` mutations on this hook —
// otherwise a manager change would silently leave stale sales-person/posting
// data in the query cache.
describe('useSalesPersonMutations invalidation', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  function setup() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useSalesPersonMutations(), { wrapper })
    return { result, invalidateSpy }
  }

  it('invalidates the same query keys as transfer after updatePostingManager', async () => {
    const manager = await repository.createSalesPerson({
      name: 'Manager', officialEmail: 'mgr-inv@example.com', designation: 'RM', tierKey: 'rm',
    })
    const person = await repository.createSalesPerson({
      name: 'Report', officialEmail: 'report-inv@example.com', designation: 'Account Manager', tierKey: 'accountManager',
    })

    const { result, invalidateSpy } = setup()

    await result.current.updatePostingManager.mutateAsync({ personId: person.id, managerId: manager.id })
    await waitFor(() => expect(result.current.updatePostingManager.isSuccess).toBe(true))

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0])
    expect(invalidatedKeys).toEqual(expect.arrayContaining(['salesPersons', 'salesPerson', 'salesPostings', 'currentPostings']))
  })
})
