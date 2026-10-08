import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { FriendlyDateInput } from '@/components/ui/FriendlyDateInput'
import { DraftNotice } from '@/components/ui/DraftNotice'
import { useToast } from '@/components/ui/Toast'
import {
  useAllEmployees, useBreadcrumb, useEmployeeMutations, useEmployeesUnder, useNode,
  useOrgRoots, usePostingNodes,
} from '@/lib/api'
import { isoToday } from '@/data/repository'
import { useFormDraft } from '@/lib/useFormDraft'
import { NODE_TYPE_MAP } from '@/lib/node-types'
import { EmployeePicker } from './EmployeePicker'
import type { Employee } from '@/lib/types'

export function TransferDialog({ open, employee, onClose }: {
  open: boolean
  employee: Employee | null
  onClose: () => void
}) {
  const toast = useToast()
  const { transfer } = useEmployeeMutations()
  const { data: currentPosting } = useNode(employee?.orgNodeId ?? null)
  const { data: currentChain = [] } = useBreadcrumb(employee?.orgNodeId ?? null)
  const stateCode = currentPosting?.stateCode ?? null
  const { data: departments = [] } = useOrgRoots(stateCode ?? -1)
  const { data: postings = [] } = usePostingNodes(stateCode)
  const { data: allEmployees = [] } = useAllEmployees()

  const emptyForm = () => ({
    toDepartmentId: '', toOrgNodeId: '', toDesignation: employee?.designation ?? '',
    toManagerId: employee?.managerId ?? '', effectiveDate: isoToday(), reason: '', remarks: '',
  })
  const [form, setForm] = useState(emptyForm)

  const draftKey = employee ? `transfer:${employee.id}` : null
  const draft = useFormDraft(draftKey, form, open, () => setForm(emptyForm()))

  // Offices/units that sit under the picked department. There's no flat
  // office→department index, so we derive it from the people posted in the
  // department's subtree (their org nodes are exactly its offices).
  const { data: deptEmployees = [] } = useEmployeesUnder(form.toDepartmentId || null)
  const officeIdsInDept = useMemo(() => new Set(deptEmployees.map((e) => e.orgNodeId)), [deptEmployees])

  const currentDepartment = useMemo(
    () => currentChain.find((n) => n.typeKey === 'department') ?? null,
    [currentChain],
  )

  useEffect(() => {
    if (open && employee) {
      const base = emptyForm()
      setForm(draft.take(base) ?? base)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee])

  // Default the department to the employee's current one once the breadcrumb
  // resolves — without clobbering a choice the user has already made.
  useEffect(() => {
    if (!open || !currentDepartment) return
    setForm((f) => (f.toDepartmentId ? f : { ...f, toDepartmentId: currentDepartment.id }))
  }, [open, currentDepartment])

  const targets = useMemo(
    () => postings.filter((p) =>
      p.id !== employee?.orgNodeId
      && (officeIdsInDept.has(p.id) || p.parentId === form.toDepartmentId)),
    [postings, employee?.orgNodeId, officeIdsInDept, form.toDepartmentId],
  )

  // Distinct designations already in use system-wide, with the employee's
  // current one guaranteed to remain selectable.
  const designations = useMemo(() => {
    const set = new Set(allEmployees.map((e) => e.designation).filter(Boolean))
    if (employee?.designation) set.add(employee.designation)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [allEmployees, employee?.designation])

  async function submit() {
    if (!employee || !form.toOrgNodeId) return
    await transfer.mutateAsync({
      employeeId: employee.id,
      toOrgNodeId: form.toOrgNodeId,
      toDesignation: form.toDesignation.trim(),
      toManagerId: form.toManagerId || null,
      effectiveDate: form.effectiveDate,
      reason: form.reason.trim(),
      remarks: form.remarks.trim(),
    })
    toast(`Transferred ${employee.name}`)
    draft.clear()
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Transfer employee"
      description={employee ? employee.name : undefined}
      footer={
        <>
          <Button onClick={onClose} disabled={transfer.isPending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!form.toOrgNodeId || transfer.isPending}>
            {transfer.isPending ? 'Recording…' : 'Record transfer'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {draft.restored && <DraftNotice onDiscard={draft.discard} />}
        <div className="rounded-lg border border-line bg-panel/50 px-3 py-2.5 text-[13px]">
          <span className="text-[11px] uppercase tracking-wide text-muted">Current posting</span>
          <p className="mt-0.5 text-ink-900">{currentPosting?.name ?? '—'} · {employee?.designation}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="New department">
            <Select
              value={form.toDepartmentId}
              onChange={(e) => setForm((f) => ({ ...f, toDepartmentId: e.target.value, toOrgNodeId: '' }))}
            >
              <option value="">Select a department…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="New posting" required>
            <Select
              value={form.toOrgNodeId}
              onChange={(e) => setForm((f) => ({ ...f, toOrgNodeId: e.target.value }))}
              disabled={!form.toDepartmentId}
            >
              <option value="">Select a posting…</option>
              {targets.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({NODE_TYPE_MAP[p.typeKey]?.label})</option>
              ))}
              {form.toDepartmentId && targets.length === 0 && (
                <option value="" disabled>No offices in this department</option>
              )}
            </Select>
          </Field>
          <Field label="New designation">
            <Select value={form.toDesignation} onChange={(e) => setForm((f) => ({ ...f, toDesignation: e.target.value }))}>
              {designations.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reports to" hint="New reporting manager after the transfer">
            <EmployeePicker
              candidates={allEmployees.filter((e) => e.id !== employee?.id)}
              value={form.toManagerId}
              onChange={(id) => setForm((f) => ({ ...f, toManagerId: id }))}
            />
          </Field>
          <Field label="Effective date">
            <FriendlyDateInput value={form.effectiveDate} onChange={(v) => setForm((f) => ({ ...f, effectiveDate: v }))} />
          </Field>
          <Field label="Reason">
            <Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Administrative transfer" />
          </Field>
        </div>
        <Field label="Remarks" hint="Previous & new posting, department, and office are recorded automatically.">
          <Textarea value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
        </Field>
      </div>
    </Dialog>
  )
}
