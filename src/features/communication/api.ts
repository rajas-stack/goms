import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AppRouter } from '../../../apps/api/src/index'
import { getAuthHeaders } from '@/data/remote/authHeaders'
import { repository } from '@/data/repository'
import { usePermissions } from '@/lib/permissions'
import { authApi, useAuthUser } from '@/lib/auth'
import type { CommunicationPerson, ContactParty } from '@goms/domain'

const clients = new Map<string, ReturnType<typeof createTRPCClient<AppRouter>>>()
export function communicationApi() {
  if (!import.meta.env.VITE_API_BASE_URL) throw new Error('Email communication requires the connected GOMS server.')
  const key = 'current-sign-in'
  if (!clients.has(key)) {
    clients.clear()
    clients.set(key, createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${import.meta.env.VITE_API_BASE_URL}/api/trpc`, headers: getAuthHeaders, fetch: authApi.fetch })] }))
  }
  const client = clients.get(key)!
  return client.bidCommunications
}
export function useCommunicationContacts() {
  const { user: account } = useAuthUser()
  const permissions = usePermissions()
  return useQuery({ queryKey: ['communicationContacts', account?.email], enabled: !!account && permissions.can('am.contacts', 'read'), queryFn: () => communicationApi().contacts.query() })
}
type ContactInput = { name: string; party: ContactParty; organization: string; departmentId: string | null }
/** Address-book writes; each refreshes the contacts every Directory and master view reads. */
export function useContactMutations() {
  const qc = useQueryClient()
  const onSuccess = () => qc.invalidateQueries({ queryKey: ['communicationContacts'] })
  return {
    create: useMutation({ mutationFn: (input: ContactInput & { email: string }) => communicationApi().createContact.mutate(input), onSuccess }),
    update: useMutation({ mutationFn: (input: ContactInput & { id: string }) => communicationApi().updateContact.mutate(input), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => communicationApi().deleteContact.mutate({ id }), onSuccess }),
  }
}
export function useCommunicationDirectory() {
  const { user: account } = useAuthUser()
  const permissions = usePermissions()
  return useQuery({ queryKey: ['communicationDirectory', account?.email, permissions.roles, permissions.enforced], enabled: !!account, queryFn: async () => {
    const requests: Promise<CommunicationPerson[]>[] = [
      permissions.can('team.org', 'read') ? repository.listOrgPeople().then(rows => rows.map(row => ({ id: row.id, name: row.name, email: row.email, source: 'org' as const, party: 'internal' as const }))) : Promise.resolve([]),
      permissions.can('team.org', 'read') ? repository.listDeliveryTeamMembers().then(rows => rows.map(row => ({ id: row.id, name: row.name, email: row.email, source: 'delivery' as const, party: 'delivery' as const }))) : Promise.resolve([]),
      permissions.can('am.contacts', 'read') ? repository.listAllEmployees().then(rows => rows.map(row => ({ id: row.id, name: row.name, email: row.email, source: 'client' as const, party: 'client' as const }))) : Promise.resolve([]),
      repository.listSalesPersons().then(rows => rows.map(row => ({ id: row.id, name: row.name, email: row.officialEmail, source: 'sales' as const, party: 'internal' as const }))),
    ]
    const results = await Promise.allSettled(requests)
    const people: CommunicationPerson[] = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
    return { people, incomplete: results.some(result => result.status === 'rejected') }
  } })
}
