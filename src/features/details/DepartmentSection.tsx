import { SALES_ROLES, parseWorks } from '@/features/nodes/department-meta'
import type { Employee, HierNode } from '@/lib/types'

/** Read-only display of a department's head, sales ownership, and works.
 *  Rendered inside NodeDetails when the selected node is a department. */
export function DepartmentSection({ node, employees }: { node: HierNode; employees: Employee[] }) {
  const byId = new Map(employees.map((e) => [e.id, e]))
  const head = node.metadata.deptHead ? byId.get(node.metadata.deptHead) : undefined
  const owners = SALES_ROLES
    .map((r) => ({ ...r, emp: node.metadata[r.key] ? byId.get(node.metadata[r.key]) : undefined }))
    .filter((o): o is typeof o & { emp: Employee } => !!o.emp)
  const works = parseWorks(node.metadata.works)

  if (!head && owners.length === 0 && works.length === 0) return null

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
        <Block title="Sales ownership">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {owners.map((o) => (
              <div key={o.key}>
                <dt className="text-[11px] uppercase tracking-wide text-muted">{o.label}</dt>
                <dd className="mt-0.5 text-sm text-ink-900">{o.emp.name}</dd>
              </div>
            ))}
          </dl>
        </Block>
      )}

      {works.length > 0 && (
        <Block title={`Works · ${works.length}`}>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="pb-1.5 pr-3 font-medium">Work</th>
                  <th className="pb-1.5 pr-3 font-medium">Component</th>
                  <th className="pb-1.5 pr-3 font-medium">Qty</th>
                  <th className="pb-1.5 pr-3 font-medium">Value</th>
                  <th className="pb-1.5 font-medium">Vertical / OEM</th>
                </tr>
              </thead>
              <tbody>
                {works.map((w) => (
                  <tr key={w.id} className="border-t border-line">
                    <td className="py-1.5 pr-3 text-ink-900">{w.name || '—'}</td>
                    <td className="py-1.5 pr-3 text-ink-700">{w.component || '—'}</td>
                    <td className="py-1.5 pr-3 text-ink-700">{w.quantity || '—'}</td>
                    <td className="py-1.5 pr-3 text-ink-700">{w.value || '—'}</td>
                    <td className="py-1.5 text-ink-700">{w.vertical || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
      )}
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
