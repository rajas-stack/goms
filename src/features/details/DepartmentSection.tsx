import { SALES_ROLES, parseWorks, serializeWorks } from '@/features/nodes/department-meta'
import { WorksEditor } from '@/features/nodes/WorksEditor'
import { SALES_TEAM } from '@/data/sales-team'
import { resolveSalesChain } from '@/data/sales-hierarchy'
import { useNodeMutations } from '@/lib/api'
import type { Employee, HierNode } from '@/lib/types'
import type { SalesTeamMember } from '@/data/sales-team'

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
  const { update } = useNodeMutations()
  const byId = new Map(employees.map((e) => [e.id, e]))
  const head = node.metadata.deptHead ? byId.get(node.metadata.deptHead) : undefined

  const geoEmail = node.metadata.salesGeo
  const geo = geoEmail ? SALES_TEAM.find((m) => m.email === geoEmail) : undefined
  const chain = resolveSalesChain(geoEmail ?? '')
  const geoRole = SALES_ROLES[0]

  const owners: { key: string; label: string; member: SalesTeamMember }[] = [
    ...(geo ? [{ key: geoRole.key, label: geoRole.label, member: geo }] : []),
    ...DERIVED_SALES_ROLES.flatMap((r) => {
      const member = chain[r.tier]
      return member ? [{ key: r.tier, label: r.label, member }] : []
    }),
  ]

  const works = parseWorks(node.metadata.works)
  const setWorks = (next: typeof works) =>
    update.mutate({ id: node.id, patch: { metadata: { ...node.metadata, works: serializeWorks(next) } } })

  return (
    <>
      {head && (
        <Block title="Department head">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted">Name</dt>
              <dd className="mt-0.5 text-sm text-ink-900">{head.name}</dd>
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
            {owners.map((o) => (
              <div key={o.key}>
                <dt className="text-[11px] uppercase tracking-wide text-muted">{o.label}</dt>
                <dd className="mt-0.5 text-sm text-ink-900">{o.member.name}</dd>
              </div>
            ))}
          </dl>
        </Block>
      )}

      <Block title={works.length > 0 ? `Works · ${works.length}` : 'Works'}>
        <WorksEditor works={works} onChange={setWorks} draftKeyPrefix={`work:${node.id}`} />
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
