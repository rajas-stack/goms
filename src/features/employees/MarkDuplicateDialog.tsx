import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { useAllEmployees, useEmployeeMutations } from '@/lib/api'
import { useToast } from '@/components/ui/Toast'
import type { Employee } from '@/lib/types'

/** Lets a user manually flag `employee` as a duplicate of another, named
 *  contact — picked from every other active, non-vacant employee. Stores the
 *  pointer as `metadata.duplicateOf = <the other employee's id>`, the same
 *  free-form-metadata convention `relationshipOwner` already uses. Purely
 *  manual: no name/phone/email matching happens here. */
export function MarkDuplicateDialog({ open, employee, onClose }: {
  open: boolean
  employee: Employee
  onClose: () => void
}) {
  const toast = useToast()
  const { update } = useEmployeeMutations()
  const { data: allEmployees = [] } = useAllEmployees()
  const [selected, setSelected] = useState('')

  useEffect(() => {
    if (open) setSelected('')
  }, [open])

  const options = useMemo(
    () => allEmployees
      .filter((e) => e.id !== employee.id && !e.vacant)
      .map((e) => ({ value: e.id, label: `${e.name} · ${e.designation}` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [allEmployees, employee.id],
  )

  async function save() {
    if (!selected) return
    await update.mutateAsync({
      id: employee.id,
      patch: { metadata: { ...employee.metadata, duplicateOf: selected } },
    })
    toast('Marked as a possible duplicate')
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Mark as duplicate of…"
      description={employee.name}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!selected}>Mark as duplicate</Button>
        </>
      }
    >
      <Combobox
        value={selected}
        onChange={setSelected}
        options={options}
        placeholder="Search for the original contact…"
        aria-label="Original contact"
      />
    </Dialog>
  )
}
