import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useAllEmployees, useEmployeeMutations } from '@/lib/api'
import { isoToday } from '@/data/repository'
import { MANUAL_EVENT_TYPES, TIMELINE_META } from '@/lib/timeline-meta'
import { SALES_TEAM } from '@/data/sales-team'
import { EmployeePicker } from './EmployeePicker'
import { cn } from '@/lib/utils'
import type { TimelineEventType } from '@/lib/types'

/**
 * `employeeId: null` opens the dialog with an employee-search/pick step
 * first (used by the global "add event" entry point, which has no
 * pre-selected person); once someone is picked, it proceeds into the exact
 * same create-event flow as the profile's "+ Add event" button, which always
 * passes a real `employeeId` and therefore never sees this step at all.
 */
export function TimelineEventDialog({ open, employeeId, onClose }: {
  open: boolean
  employeeId: string | null
  onClose: () => void
}) {
  const toast = useToast()
  const { addTimelineEvent } = useEmployeeMutations()
  const { data: allEmployees = [] } = useAllEmployees()
  const [pickedEmployeeId, setPickedEmployeeId] = useState<string | null>(null)
  const activeEmployeeId = employeeId ?? pickedEmployeeId
  const showPicker = !activeEmployeeId
  const pickedEmployee = pickedEmployeeId ? allEmployees.find((e) => e.id === pickedEmployeeId) : undefined
  const [form, setForm] = useState({
    type: 'meeting' as TimelineEventType, title: '', date: isoToday(), time: '', note: '', attendees: [] as string[],
  })

  useEffect(() => {
    if (open) {
      setForm({ type: 'meeting', title: '', date: isoToday(), time: '', note: '', attendees: [] })
      setPickedEmployeeId(null)
    }
  }, [open])

  function toggleAttendee(name: string) {
    setForm((f) => ({
      ...f,
      attendees: f.attendees.includes(name) ? f.attendees.filter((a) => a !== name) : [...f.attendees, name],
    }))
  }

  async function submit() {
    if (!activeEmployeeId || !form.title.trim()) return
    await addTimelineEvent.mutateAsync({
      employeeId: activeEmployeeId, type: form.type, title: form.title.trim(), date: form.date, time: form.time,
      note: form.note, attendees: form.attendees,
    })
    toast('Timeline event added')
    onClose()
  }

  if (showPicker) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title="Add timeline event"
        description="Choose who this event is for"
        footer={<Button onClick={onClose}>Cancel</Button>}
      >
        <Field label="Person" hint="Search by name or designation">
          <EmployeePicker
            candidates={allEmployees}
            value=""
            onChange={(id) => { if (id) setPickedEmployeeId(id) }}
            placeholder="Search a person…"
          />
        </Field>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add timeline event"
      description={!employeeId && pickedEmployee ? `For ${pickedEmployee.name}` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!form.title.trim()}>Add event</Button>
        </>
      }
    >
      <div className="space-y-4">
        {!employeeId && pickedEmployee && (
          <button
            type="button"
            onClick={() => setPickedEmployeeId(null)}
            className="text-[12px] font-medium text-teal-600 hover:underline"
          >
            Change person
          </button>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Type">
            <Select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as TimelineEventType }))}
            >
              {MANUAL_EVENT_TYPES.map((t) => (
                <option key={t} value={t}>{TIMELINE_META[t].label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </Field>
          <Field label="Time">
            <Input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} />
          </Field>
        </div>
        <Field label="Title">
          <Input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g. Budget review meeting"
            autoFocus
          />
        </Field>
        <Field label="Attending AMNEX Sales Team Members" hint="Select any internal attendees">
          <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto scrollbar-thin rounded-lg border border-line bg-white p-2 sm:grid-cols-2">
            {SALES_TEAM.map((m) => (
              <label
                key={m.email}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                  form.attendees.includes(m.name) ? 'bg-ink-900/[0.06] text-ink-900' : 'text-ink-700 hover:bg-ink-900/[0.04]',
                )}
              >
                <input
                  type="checkbox"
                  checked={form.attendees.includes(m.name)}
                  onChange={() => toggleAttendee(m.name)}
                  className="accent-ink-900"
                />
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="Note" hint="Optional details about this event.">
          <Textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </Field>
      </div>
    </Dialog>
  )
}
