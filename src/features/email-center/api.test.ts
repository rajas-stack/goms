import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
vi.mock('@/lib/auth', () => ({ authApi: { subscribe: vi.fn(), fetch: vi.fn() }, useAuthUser: vi.fn() }))
vi.mock('@/data/remote/authHeaders', () => ({ getAuthHeaders: vi.fn() }))
import { emailQueryDefaults } from './api'

it('rechecks authorization on reopening instead of returning a cached message after revocation', async () => {
  const client = new QueryClient({ defaultOptions: { queries: emailQueryDefaults } })
  const queryKey = ['emailCenter', 'fixture@amnex.com', 'read', 'thread']
  await client.fetchQuery({ queryKey, queryFn: async () => 'private message' })
  await expect(client.fetchQuery({ queryKey, queryFn: async () => { throw new Error('Access revoked') } })).rejects.toThrow('Access revoked')
  client.clear()
})
it('disposes of message data when the last viewer closes', async () => {
  const client = new QueryClient({ defaultOptions: { queries: emailQueryDefaults } })
  const queryKey = ['emailCenter', 'fixture@amnex.com', 'read', 'thread']
  const observer = new QueryObserver(client, { queryKey, queryFn: async () => 'private message' })
  const unsubscribe = observer.subscribe(() => {})
  await observer.refetch()
  expect(client.getQueryData(queryKey)).toBe('private message')
  unsubscribe()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(client.getQueryData(queryKey)).toBeUndefined()
  client.clear()
})
