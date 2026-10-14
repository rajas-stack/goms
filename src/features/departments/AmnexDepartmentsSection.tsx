import { useState } from 'react'
import type { AmnexDepartment } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { useAllowed } from '@/lib/permissions'
import { useAmnexDepartmentMutations, useAmnexDepartments } from './api'
import { DepartmentRow } from './DepartmentRow'

const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/** Settings > Masters > Employee Master > Amnex Departments: the departments offered to employees (Teams > Employees).
 *  Reads are open to every role; writes need the same permission as editing employees (Company Org Structure). */
export function AmnexDepartmentsSection() {
  const { data: departments = [], isLoading, error: loadError } = useAmnexDepartments()
  const m = useAmnexDepartmentMutations()
  const canCreate = useAllowed('team.org', 'create')
  const canUpdate = useAllowed('team.org', 'update')
  const canDelete = useAllowed('team.org', 'delete')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AmnexDepartment | null>(null)

  const run = async (action: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    setError(null)
    try { await action(); return true } catch (cause) { setError(message(cause, fallback)); return false }
  }
  const add = async () => {
    if (!name.trim()) return
    if (await run(() => m.create.mutateAsync(name), 'Could not add the department.')) setName('')
  }
  const move = (d: AmnexDepartment, step: -1 | 1) => {
    const ids = departments.map((x) => x.id)
    const at = ids.indexOf(d.id)
    const to = at + step
    if (to < 0 || to >= ids.length) return
    const next = ids.map((id, i) => (i === at ? ids[to] : i === to ? ids[at] : id))
    void run(() => m.reorder.mutateAsync(next), 'Could not reorder.')
  }
  const confirmDelete = async () => {
    if (!deleting) return
    if (await run(() => m.remove.mutateAsync(deleting.id), 'Could not delete the department.')) setDeleting(null)
  }

  return (
    <section aria-labelledby="amnex-departments-heading" className="mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="amnex-departments-heading" className="font-display text-lg font-semibold text-ink-900">Amnex Departments</h2>
          <p className="mt-0.5 max-w-2xl text-[13px] text-muted">
            The departments employees can belong to in Teams → Employees. System departments derive roles and the Pre-sales,
            Bid and Legal rosters, so they cannot be renamed or deleted.
          </p>
        </div>
        {canCreate && (
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void add() }}>
            <Input aria-label="New department name" placeholder="New department…" value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-56" />
            <Button type="submit" variant="primary" size="sm" disabled={!name.trim() || m.create.isPending}><Icon name="Plus" size={14} /> Add department</Button>
          </form>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 flex items-center gap-2 rounded-lg bg-crimson-100 px-3 py-1.5 text-[12px] text-crimson">
          {error}
          <button aria-label="Dismiss" className="ml-auto" onClick={() => setError(null)}><Icon name="X" size={12} /></button>
        </p>
      )}
      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-white">
        {isLoading ? <p className="p-4 text-[13px] text-muted">Loading departments…</p>
          : loadError ? <p role="alert" className="p-4 text-[13px] text-crimson">{message(loadError, 'Could not load departments.')}</p>
          : departments.length === 0 ? <p className="p-4 text-[13px] text-muted">No departments yet.</p>
          : (
            <ul aria-label="Amnex departments">
              {departments.map((d, i) => (
                <DepartmentRow
                  key={d.id} department={d} isFirst={i === 0} isLast={i === departments.length - 1}
                  canRename={canUpdate} canReorder={canUpdate} canDelete={canDelete}
                  onRename={(dep, next) => run(() => m.rename.mutateAsync({ id: dep.id, name: next }), 'Could not rename the department.')}
                  onMove={move} onDelete={setDeleting}
                />
              ))}
            </ul>
          )}
      </div>
      <Dialog
        open={!!deleting} onClose={() => setDeleting(null)} title={deleting ? `Delete “${deleting.name}”?` : ''}
        footer={<>
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" disabled={m.remove.isPending} onClick={() => void confirmDelete()}>Delete department</Button>
        </>}
      >
        <p className="text-[13px] text-ink-700">
          {deleting?.employeeCount
            ? <><strong>{deleting.employeeCount} employee{deleting.employeeCount === 1 ? '' : 's'}</strong> {deleting.employeeCount === 1 ? 'is' : 'are'} in this department. It will be removed from them.</>
            : 'No employee is in this department.'}
        </p>
      </Dialog>
    </section>
  )
}
