// Additive, tRPC-backed Repository implementation — only wired in when
// VITE_API_BASE_URL is set (see ../repository.ts). Implements Partial<Repository>
// so any other method call is simply absent (undefined) rather than needing
// ~100 hand-written throwing stubs; nothing routes through this today.
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../../../apps/api/src/index'
import type { Repository, CreateCustomerInput } from '../repository'
import type { Customer } from '@/lib/types'

export class RemoteRepository implements Partial<Repository> {
  private client = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${import.meta.env.VITE_API_BASE_URL}/api/trpc` })],
  })

  listCustomers = (): Promise<Customer[]> => this.client.customers.list.query()
  getCustomer = (id: string): Promise<Customer | null> => this.client.customers.get.query({ id })
  createCustomer = (input: CreateCustomerInput): Promise<Customer> =>
    this.client.customers.create.mutate(input)
  updateCustomer = (id: string, patch: Partial<Customer>): Promise<Customer> =>
    this.client.customers.update.mutate({ id, patch, expectedUpdatedAt: patch.updatedAt })
  deleteCustomer = (id: string): Promise<void> => this.client.customers.delete.mutate({ id })
}
