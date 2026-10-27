import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Combobox } from '@/components/ui/Combobox'
import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import { useToast } from '@/components/ui/Toast'
import { useAllEmployees, useEmployeeMutations, useStates } from '@/lib/api'
import { useClientDepartmentOptions } from '@/features/masters/useMasterOptions'
import type { Employee } from '@/lib/types'
import { matchParticipants, type MarketingEvent } from './eventParticipants'

/** The event's participants who are in the Directory, by their Directory department, each with a "Reports to" picker.
 *  It sets the same reporting line Account Mapping draws, so a change here shows there and the other way round. */
export function EventHierarchy({ event }: { event: MarketingEvent }) {
  const toast = useToast()
  const { data: people = [] } = useAllEmployees()
  const { data: departments = [] } = useClientDepartmentOptions()
  const { data: states = [] } = useStates()
  const { setManager } = useEmployeeMutations()
  const [busyId, setBusyId] = useState<string | null>(null)
  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments])
  const stateName = useMemo(() => new Map(states.map((s) => [s.code, s.name])), [states])

  const groups = useMemo(() => {
    const inDirectory = [...new Map(matchParticipants(event.participants, people).flatMap((p) => (p ? [[p.id, p] as const] : []))).values()]
    const byNode = new Map<string, Employee[]>()
    for (const p of inDirectory) byNode.set(p.orgNodeId, [...(byNode.get(p.orgNodeId) ?? []), p])
    return [...byNode].sort((a, b) => b[1].length - a[1].length)
  }, [event, people])

  const reassign = async (emp: Employee, managerId: string) => {
    setBusyId(emp.id)
    try { await setManager.mutateAsync({ employeeId: emp.id, managerId: managerId || null }) }
    catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not change the reporting line.') }
    finally { setBusyId(null) }
  }

  if (!groups.length) return <p className="text-sm text-muted">None of this event’s participants are in the Directory yet.</p>

  return (
    <div className="space-y-4">
      {groups.map(([nodeId, members]) => {
        const dept = deptById.get(nodeId)
        // Anyone in the same Directory department can be a manager, not only this event's participants.
        const colleagues = people.filter((p) => p.orgNodeId === nodeId && !p.vacant)
        const ordered = depthFirst(members)
        return (
          <section key={nodeId} className="rounded-xl border border-line bg-white">
            <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
              <h2 className="text-sm font-semibold text-ink-900">
                {dept?.name ?? 'Other unit'}
                {dept?.stateCode != null && <span className="font-normal text-muted"> · {stateName.get(dept.stateCode)}</span>}
              </h2>
              {dept?.stateCode != null && (
                <Link to={`/state/${dept.stateCode}?sel=${nodeId}&kind=node`} className="flex items-center gap-1 text-[12px] text-teal-600 hover:underline">
                  Open in Account Mapping <Icon name="ExternalLink" size={12} />
                </Link>
              )}
            </header>
            <ul className="divide-y divide-line">
              {ordered.map(({ emp, depth }) => (
                <li key={emp.id} className="grid items-center gap-2 px-3 py-1.5 sm:grid-cols-[1fr_minmax(0,18rem)]">
                  <span style={{ paddingLeft: depth * 20 }} className="flex min-w-0 items-center gap-1">
                    {depth > 0 && <Icon name="CornerDownLeft" size={12} className="shrink-0 -scale-x-100 text-muted" />}
                    <PersonName person={emp} size="xs" subtitle={emp.designation} />
                  </span>
                  <Combobox aria-label={`${emp.name} reports to`} value={emp.managerId ?? ''} placeholder="Reports to — nobody"
                    disabled={busyId === emp.id} onChange={(v) => void reassign(emp, v)}
                    options={[{ value: '', label: 'Nobody (top of department)' },
                      ...colleagues.filter((c) => c.id !== emp.id).map((c) => ({ value: c.id, label: `${c.name} · ${c.designation}` }))]} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/** Managers before their reports, indented; anyone whose manager isn't in the list starts a branch. */
function depthFirst(members: Employee[]): { emp: Employee; depth: number }[] {
  const ids = new Set(members.map((m) => m.id))
  const out: { emp: Employee; depth: number }[] = []
  const seen = new Set<string>()
  const visit = (emp: Employee, depth: number) => {
    if (seen.has(emp.id)) return // guards a reporting cycle
    seen.add(emp.id); out.push({ emp, depth })
    for (const r of members.filter((m) => m.managerId === emp.id)) visit(r, depth + 1)
  }
  for (const m of members) if (!m.managerId || !ids.has(m.managerId)) visit(m, 0)
  for (const m of members) visit(m, 0) // anything left is in a cycle
  return out
}
