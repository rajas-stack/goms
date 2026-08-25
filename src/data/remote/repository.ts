// Additive, tRPC-backed Repository implementation — only wired in when
// VITE_API_BASE_URL is set (see ../repository.ts). Implements Partial<Repository>
// so any other method call is simply absent (undefined) rather than needing
// ~100 hand-written throwing stubs; nothing routes through this today.
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../../../apps/api/src/index'
import type { Repository, CreateCustomerInput, CreateNodeInput, ImportChildRow, StateSummary } from '../repository'
import type { Customer, HierNode, Status } from '@/lib/types'

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

  listStates = (): Promise<StateSummary[]> => this.client.hierarchy.listStates.query()
  getState = (code: number): Promise<HierNode | undefined> =>
    this.client.hierarchy.getState.query({ code }).then((r) => r ?? undefined)
  getNode = (id: string): Promise<HierNode | undefined> =>
    this.client.hierarchy.getNode.query({ id }).then((r) => r ?? undefined)
  listChildren = (parentId: string): Promise<HierNode[]> => this.client.hierarchy.listChildren.query({ parentId })
  listOrgRoots = (stateCode: number): Promise<HierNode[]> => this.client.hierarchy.listOrgRoots.query({ stateCode })
  listDepartments = (): Promise<HierNode[]> => this.client.hierarchy.listDepartments.query()
  listPostingNodes = (stateCode: number): Promise<HierNode[]> => this.client.hierarchy.listPostingNodes.query({ stateCode })
  breadcrumb = (id: string): Promise<HierNode[]> => this.client.hierarchy.breadcrumb.query({ id })
  childCount = (id: string): Promise<number> => this.client.hierarchy.childCount.query({ id })
  geoRoot = (): Promise<HierNode | undefined> => this.client.hierarchy.geoRoot.query().then((r) => r ?? undefined)
  childCounts = (parentId: string): Promise<Record<string, number>> => this.client.hierarchy.childCounts.query({ parentId })
  createNode = (input: CreateNodeInput): Promise<HierNode> => this.client.hierarchy.createNode.mutate(input)
  updateNode = (id: string, patch: Partial<Pick<HierNode, 'name' | 'metadata'>>): Promise<HierNode> =>
    this.client.hierarchy.updateNode.mutate({ id, patch })
  setNodeStatus = (id: string, status: Status): Promise<void> => this.client.hierarchy.setNodeStatus.mutate({ id, status })
  deleteNode = (id: string): Promise<void> => this.client.hierarchy.deleteNode.mutate({ id })
  moveNode = (id: string, newParentId: string | null): Promise<void> =>
    this.client.hierarchy.moveNode.mutate({ id, newParentId })
  duplicateNode = (id: string): Promise<HierNode> => this.client.hierarchy.duplicateNode.mutate({ id })
  importChildren = (parentId: string, rows: ImportChildRow[]): Promise<number> =>
    this.client.hierarchy.importChildren.mutate({ parentId, rows })
  moveTargets = (nodeId: string): Promise<HierNode[]> => this.client.hierarchy.moveTargets.query({ nodeId })
  reorderNode = (id: string, beforeId: string | null): Promise<void> =>
    this.client.hierarchy.reorderNode.mutate({ id, beforeId })
}
