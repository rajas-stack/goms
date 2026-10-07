import { NO_PERMISSION_TITLE, useAllowed, usePermissions } from '@/lib/permissions'
import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useAllEmployees, useEmployeeMutations } from '@/lib/api'
import { isoToday } from '@/data/repository'
import { EmployeePicker } from './EmployeePicker'
import type { HierNode } from '@/lib/types'

/** Transfers an EXISTING employee onto `orgNode`, as an alternative to
 *  `EmployeeFormDialog`'s "Add employee" (which creates a brand-new person).
 *  Opened from a department/branch/division/office/unit card's "+" menu. */
export function SelectEmployeeDialog({ open, orgNode, onClose }: {
  open: boolean
  orgNode: HierNode | null
  onClose: () => void
}) {
  const toast = useToast()
  const { transfer } = useEmployeeMutations()
  const canUpdateContacts = useAllowed('am.contacts', 'update')
  const canUpdateDepartments = useAllowed('am.departments', 'update')
  const allowed = canUpdateContacts && canUpdateDepartments // re-posting touches both
  const { data: allEmployees = [] } = useAllEmployees()

  const [employeeId, setEmployeeId] = useState('')
  const [designation, setDesignation] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(isoToday())
  const [reason, setReason] = useState('')
  const [remarks, setRemarks] = useState('')

  const candidates = useMemo(
    () => allEmployees.filter((e) => !e.vacant && e.orgNodeId !== orgNode?.id),
    [allEmployees, orgNode?.id],
  )
  const employee = allEmployees.find((e) => e.id === employeeId) ?? null

  useEffect(() => {
    if (open) {
      setEmployeeId(''); setDesignation(''); setEffectiveDate(isoToday()); setReason(''); setRemarks('')
    }
  }, [open])

  useEffect(() => {
    if (employee) setDesignation((d) => d || employee.designation)
  }, [employee])

  async function submit() {
    if (!employee || !orgNode) return
    await transfer.mutateAsync({
      employeeId: employee.id,
      toOrgNodeId: orgNode.id,
      toDesignation: designation.trim() || employee.designation,
      toManagerId: employee.managerId,
      effectiveDate,
      reason: reason.trim(),
      remarks: remarks.trim(),
    })
    toast(`Moved ${employee.name} to ${orgNode.name}`)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Select employee"
      description={orgNode ? `Move an existing person to ${orgNode.name}` : undefined}
      footer={
        <>
          <Button onClick={onClose} disabled={transfer.isPending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={(!employeeId || transfer.isPending) || !allowed} title={allowed ? undefined : NO_PERMISSION_TITLE}>
            {transfer.isPending ? 'Moving…' : 'Move here'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Person" hint="Search by name or designation" required>
          <EmployeePicker candidates={candidates} value={employeeId} onChange={setEmployeeId} placeholder="Search a person…" />
        </Field>
        {employee && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="New designation">
                <Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder={employee.designation} />
              </Field>
              <Field label="Effective date">
                <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
              </Field>
              <Field label="Reason">
                <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">Select a reason…</option>
                  <option value="Administrative transfer">Administrative transfer</option>
                  <option value="Promotion">Promotion</option>
                  <option value="Restructuring">Restructuring</option>
                  <option value="Other">Other</option>
                </Select>
              </Field>
            </div>
            <Field label="Remarks" hint="Previous & new posting, department, and office are recorded automatically.">
              <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  )
}
