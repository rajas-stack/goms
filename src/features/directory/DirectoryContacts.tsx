import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { CommunicationContact } from '@goms/domain'
import { useAuthUser } from '@/lib/auth'
import { useCommunicationContacts } from '@/features/communication/api'

/** Settings > Masters > Directory Types code → E-mail contact category. A code that already names a
 *  category (`delivery`, `external`) maps to itself; anything else has no contacts yet. */
const PARTY_FOR_CODE: Record<string, CommunicationContact['party']> = {
  department: 'clientDepartment', clientDepartment: 'clientDepartment', oem: 'oem', delivery: 'delivery', external: 'external',
}

export function partyForDirectoryType(code: string): CommunicationContact['party'] | null {
  return PARTY_FOR_CODE[code] ?? null
}

/** A non-employee Directory type: the reviewed E-mail contacts of that category (maintained in Settings > Masters > Email Contacts). */
export function DirectoryContacts({ code, name }: { code: string; name: string }) {
  const { user } = useAuthUser()
  const query = useCommunicationContacts()
  const party = partyForDirectoryType(code)
  const rows = useMemo(() => (party ? (query.data ?? []).filter((c) => c.party === party) : []), [query.data, party])

  return (
    <section aria-label={`${name} directory`} className="flex h-full min-h-0 flex-col gap-3 p-3 sm:px-6">
      <p className="text-[12px] text-muted">
        {name} contacts come from <Link to="/settings/masters/email-contacts" className="font-semibold underline underline-offset-2">Settings › Masters › Email Contacts</Link>.
      </p>
      {!user && <p className="text-sm text-muted">Sign in with your Amnex Google account to load contacts.</p>}
      {query.isLoading && <p className="text-sm text-muted">Loading contacts…</p>}
      {query.error && <p role="alert" className="text-[12px] text-crimson">{query.error.message}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!query.isLoading && rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">
            {party ? `No ${name} contacts yet. Add participants from a bid’s Communication tab.` : `No contacts are linked to ${name} yet.`}
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {rows.map((c) => (
              <li key={c.id} className="flex min-h-12 flex-wrap items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900">{c.name}</span>
                  <span className="block truncate text-[12px] text-muted">{c.email}</span>
                </span>
                <span className="text-[12px] text-ink-700">{c.organization}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
