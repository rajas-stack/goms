import { SALES_ROLES } from '@/features/nodes/department-meta'
import { WorksEditor } from '@/features/nodes/WorksEditor'
import { liveSalesRoster, resolveSalesChain } from '@/data/sales-hierarchy'
import {
  useCurrentPostings, useNode, useOpportunitiesByDepartment, useResolvedOwners, useSalesPerson, useSalesPersons,
  useSalesPostings,
} from '@/lib/api'
import { OwnershipBlock } from '@/features/sales/OwnershipBlock'
import { OwnerBadge } from '@/features/sales/OwnerBadge'
import { Icon } from '@/components/ui/Icon'
import { useWorkspace } from '@/features/workspace/context'
import { isoToday } from '@/lib/dates'
import type { Employee, HierNode } from '@/lib/types'
import type { SalesTeamMember } from '@/data/sales-team'
import type { OwnerResolution } from '@/data/ownership'

const DERIVED_SALES_ROLES: { tier: 'rm' | 'gm' | 'salesHead'; label: string }[] = [
  { tier: 'rm', label: 'RM' },
  { tier: 'gm', label: 'GM' },
  { tier: 'salesHead', label: 'Sales Head' },
]

/** Department head and sales-ownership (read-only, shown only when set),
 *  plus the opportunity/Works pipeline (always shown, with its own "Create
 *  Opportunity" button). Rendered inside NodeDetails when the selected node
 *  is a department. */
export function DepartmentSection({ node, employees }: { node: HierNode; employees: Employee[] }) {
  const ws = useWorkspace()
  const { data: salesPersons = [] } = useSalesPersons()
  const { data: currentPostings = {} } = useCurrentPostings()
  const salesPersonByEmail = new Map(salesPersons.map((p) => [p.officialEmail, p]))
  const byId = new Map(employees.map((e) => [e.id, e]))
  const head = node.metadata.deptHead ? byId.get(node.metadata.deptHead) : undefined

  const liveRoster = liveSalesRoster(salesPersons, currentPostings)
  const geoEmail = node.metadata.salesGeo
  const geo = geoEmail ? liveRoster.find((m) => m.email === geoEmail) : undefined
  const chain = resolveSalesChain(geoEmail ?? '', liveRoster)
  const geoRole = SALES_ROLES[0]

  const owners: { key: string; label: string; member: SalesTeamMember }[] = [
    ...(geo ? [{ key: geoRole.key, label: geoRole.label, member: geo }] : []),
    ...DERIVED_SALES_ROLES.flatMap((r) => {
      const member = chain[r.tier]
      return member ? [{ key: r.tier, label: r.label, member }] : []
    }),
  ]

  const { data: opportunities = [] } = useOpportunitiesByDepartment(node.id)
  const { data: resolvedOwners = {} } = useResolvedOwners('orgNode', [node.id], isoToday())
  const resolvedOwner = resolvedOwners[node.id]
  const { data: viaNode } = useNode(resolvedOwner?.source === 'inherited' ? resolvedOwner.viaEntityId ?? null : null)
  const contactCount = employees.filter((e) => e.orgNodeId === node.id && !e.vacant).length

  return (
    <>
      {head && (
        <Block title="Department head">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted">Name</dt>
              <dd className="mt-0.5 text-sm text-ink-900">
                <button
                  onClick={() => ws.select('employee', head.id)}
                  className="cursor-pointer text-left underline decoration-line decoration-1 underline-offset-2 hover:text-ink-700 hover:decoration-ink-600"
                >
                  {head.name}
                </button>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted">Designation</dt>
              <dd className="mt-0.5 text-sm text-ink-900">{head.designation}</dd>
            </div>
          </dl>
        </Block>
      )}

      {owners.length > 0 && (
        <Block title="AMNEX sales ownership">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {owners.map((o) => {
              const person = salesPersonByEmail.get(o.member.email)
              return (
                <div key={o.key}>
                  <dt className="text-[11px] uppercase tracking-wide text-muted">{o.label}</dt>
                  <dd className="mt-0.5 text-sm text-ink-900">
                    {person ? (
                      <button
                        onClick={() => ws.select('salesPerson', person.id)}
                        className="cursor-pointer text-left underline decoration-line decoration-1 underline-offset-2 hover:text-ink-700 hover:decoration-ink-600"
                      >
                        {o.member.name}
                      </button>
                    ) : (
                      o.member.name
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
        </Block>
      )}

      <Block title="Sales information">
        <SalesInfoGrid
          owner={resolvedOwner}
          opportunityCount={opportunities.length}
          contactCount={contactCount}
        />
      </Block>

      {/* The record-based ownership system (spec §6.4/§7), shown alongside the
          legacy metadata-driven block above rather than replacing it — Phase 3
          proper is what deletes salesGeo/relationshipOwner, once every reader
          of them has moved to this. Not wrapped in <Block>: OwnershipBlock
          renders its own heading, and Block always renders one too. */}
      <section>
        <OwnershipBlock
          entityType="orgNode"
          entityId={node.id}
          entityLabel={node.name}
          owner={resolvedOwner}
          viaLabel={viaNode?.name}
        />
      </section>

      <Block title={opportunities.length > 0 ? `Works · ${opportunities.length}` : 'Works'}>
        <WorksEditor
          departmentId={node.id}
          opportunities={opportunities}
          draftKeyPrefix={`work:${node.id}`}
        />
      </Block>
    </>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 text-[13px] font-semibold text-ink-800">{title}</h3>
      {children}
    </section>
  )
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active', onLeave: 'On leave', resigned: 'Resigned', inactive: 'Inactive',
}

/** A compact "at a glance" row above the full ownership block below — owner,
 *  their current designation and status, and the two counts a manager checks
 *  first. Reads the owner's own posting/status directly rather than through
 *  Book of Business, since this is the department's view of them, not theirs
 *  of the department. */
function SalesInfoGrid({ owner, opportunityCount, contactCount }: {
  owner: OwnerResolution | null | undefined
  opportunityCount: number
  contactCount: number
}) {
  const ws = useWorkspace()
  const { data: ownerPerson } = useSalesPerson(owner?.salesPersonId ?? null)
  const { data: postings = [] } = useSalesPostings(owner?.salesPersonId ?? null)
  const currentPosting = postings.find((p) => p.endDate === null)

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      <div>
        <dt className="text-[11px] uppercase tracking-wide text-muted">Owner</dt>
        <dd className="mt-0.5 text-sm text-ink-900">
          {owner ? (
            <button onClick={() => ws.select('salesPerson', owner.salesPersonId)} className="cursor-pointer">
              <OwnerBadge owner={owner} people={ownerPerson ? [ownerPerson] : []} />
            </button>
          ) : (
            <OwnerBadge owner={owner} people={[]} />
          )}
        </dd>
      </div>
      <div>
        <dt className="text-[11px] uppercase tracking-wide text-muted">Designation</dt>
        <dd className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-900">
          <Icon name="Layers" size={13} className="text-muted" />
          {currentPosting?.designation || '—'}
        </dd>
      </div>
      <div>
        <dt className="text-[11px] uppercase tracking-wide text-muted">Status</dt>
        <dd className="mt-0.5 text-sm text-ink-900">
          {ownerPerson ? (STATUS_LABEL[ownerPerson.status] ?? ownerPerson.status) : '—'}
        </dd>
      </div>
      <div className="flex gap-4">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">Opportunities</dt>
          <dd className="mt-0.5 text-sm font-semibold text-ink-900">{opportunityCount}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">Contacts</dt>
          <dd className="mt-0.5 text-sm font-semibold text-ink-900">{contactCount}</dd>
        </div>
      </div>
    </dl>
  )
}
