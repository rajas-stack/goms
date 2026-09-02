import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown'
import { DraftNotice } from '@/components/ui/DraftNotice'
import { useToast } from '@/components/ui/Toast'
import { useAllEmployees, useEmployeeMutations, useSalesPersons } from '@/lib/api'
import { isoToday } from '@/data/repository'
import { useFormDraft } from '@/lib/useFormDraft'
import { MANUAL_EVENT_TYPES, TIMELINE_META } from '@/lib/timeline-meta'
import { EmployeePicker } from './EmployeePicker'
import type { AttendeeRef, TimelineEventType } from '@/lib/types'

/**
 * `employeeId: null` opens the dialog with an employee-search/pick step
 * first (used by the global "+ Add entry" entry point, which has no
 * pre-selected person); once someone is picked, it proceeds into the exact
 * same logging flow as the profile's "+ Add entry" button, which always
 * passes a real `employeeId` and therefore never sees this step at all.
 *
 * `initialType`/`typeFilter` let the global FAB offer separate "Create
 * Meeting" and "Log Interaction" entry points from this one dialog/mutation:
 * both omitted (the profile's own "+ Add entry" call site) preserves the
 * original behavior exactly — type defaults to 'meeting', every manual type
 * is selectable.
 */
export function TimelineEventDialog({ open, employeeId, initialType, typeFilter, onClose }: {
  open: boolean
  employeeId: string | null
  /** Type the Type field starts on. Defaults to 'meeting' (prior behavior). */
  initialType?: TimelineEventType
  /** Narrows the Type dropdown to this subset. Defaults to every manual type. */
  typeFilter?: TimelineEventType[]
  onClose: () => void
}) {
  const toast = useToast()
  const { addTimelineEvent } = useEmployeeMutations()
  const { data: allEmployees = [] } = useAllEmployees()
  const { data: salesPersons = [] } = useSalesPersons()
  const [pickedEmployeeId, setPickedEmployeeId] = useState<string | null>(null)
  const activeEmployeeId = employeeId ?? pickedEmployeeId
  const showPicker = !activeEmployeeId
  const pickedEmployee = pickedEmployeeId ? allEmployees.find((e) => e.id === pickedEmployeeId) : undefined
  const typeOptions = typeFilter && typeFilter.length > 0 ? typeFilter : MANUAL_EVENT_TYPES
  const defaultType = initialType ?? typeOptions[0]
  const EMPTY_FORM = {
    type: defaultType, title: '', customLabel: '', date: isoToday(), time: '', note: '', attendees: [] as AttendeeRef[],
    agenda: '', outcome: '', nextSteps: '',
  }
  const [form, setForm] = useState(EMPTY_FORM)

  // Keyed on the target person, not on this render's `defaultType` — a draft
  // must survive the dialog closing and reopening for the same person even
  // though `defaultType` (derived from `initialType`) could differ between
  // entry points ("Log Interaction" vs "Create Meeting" on the FAB).
  const draftKey = activeEmployeeId ? `timeline:${activeEmployeeId}` : null
  const draft = useFormDraft(draftKey, form, open, () => setForm(EMPTY_FORM))

  useEffect(() => {
    if (open) {
      setForm(draft.take(EMPTY_FORM) ?? EMPTY_FORM)
      setPickedEmployeeId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // MultiSelectDropdown operates over a plain string[] of names. Legacy
  // plain-string attendees (e.g. restored from a draft saved before this
  // picker existed) carry no salesPersonId, so they can't be represented as
  // a picker selection — they're split out and shown read-only instead,
  // rather than silently dropped. Only the resolvable (ID-carrying) subset
  // is what the picker shows/edits.
  const resolvedAttendees = useMemo(
    () => form.attendees.filter((a): a is { salesPersonId: string; name: string } => typeof a !== 'string'),
    [form.attendees],
  )
  const legacyAttendeeNames = useMemo(
    () => form.attendees.filter((a): a is string => typeof a === 'string'),
    [form.attendees],
  )

  function handleAttendeesChange(names: string[]) {
    setForm((f) => {
      const resolved: AttendeeRef[] = names.map((name) => {
        const existing = f.attendees.find((a) => typeof a !== 'string' && a.name === name)
        if (existing) return existing
        const person = salesPersons.find((p) => p.name === name)
        return person ? { salesPersonId: person.id, name: person.name } : name
      })
      const legacy = f.attendees.filter((a) => typeof a === 'string')
      return { ...f, attendees: [...legacy, ...resolved] }
    })
  }

  async function submit() {
    if (!activeEmployeeId || !form.title.trim()) return
    await addTimelineEvent.mutateAsync({
      employeeId: activeEmployeeId, type: form.type, title: form.title.trim(),
      customLabel: form.type === 'custom' ? form.customLabel.trim() : undefined,
      date: form.date, time: form.time, note: form.note, attendees: form.attendees,
      agenda: form.agenda.trim() || undefined, outcome: form.outcome.trim() || undefined,
      nextSteps: form.nextSteps.trim() || undefined,
    })
    toast('Added to timeline')
    draft.clear()
    onClose()
  }

  if (showPicker) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title="Log to timeline"
        description="Choose who this is for"
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
      title="Log to timeline"
      description={!employeeId && pickedEmployee ? `For ${pickedEmployee.name}` : undefined}
      footer={
        <>
          <Button onClick={onClose} disabled={addTimelineEvent.isPending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!form.title.trim() || addTimelineEvent.isPending}>
            {addTimelineEvent.isPending ? 'Adding…' : 'Add entry'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {draft.restored && <DraftNotice onDiscard={draft.discard} />}
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
          <Field label="Meeting type">
            <Select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as TimelineEventType }))}
            >
              {typeOptions.map((t) => (
                <option key={t} value={t}>{TIMELINE_META[t].label}</option>
              ))}
            </Select>
          </Field>
          {form.type === 'custom' && (
            <Field label="Custom type label" hint="Shown on the entry instead of “Custom”">
              <Input
                value={form.customLabel}
                onChange={(e) => setForm((f) => ({ ...f, customLabel: e.target.value }))}
                placeholder="e.g. Site visit"
              />
            </Field>
          )}
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
          <MultiSelectDropdown
            value={resolvedAttendees.map((a) => a.name)}
            onChange={handleAttendeesChange}
            groups={[{ label: null, options: salesPersons.map((p) => p.name) }]}
            storageKey="timeline-attendees"
            placeholder="Search and select attendees…"
            searchable
            searchPlaceholder="Search sales team…"
            allowCustomAdd={false}
          />
          {legacyAttendeeNames.length > 0 && (
            <p className="mt-1.5 text-[12px] text-muted">
              Also: {legacyAttendeeNames.join(', ')}{' '}
              <span className="italic">(from a saved draft; not editable here)</span>
            </p>
          )}
        </Field>
        <Field label="Note" hint="Optional details.">
          <Textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </Field>
        <Field label="Agenda" hint="Optional. What this meeting was for.">
          <Textarea value={form.agenda} onChange={(e) => setForm((f) => ({ ...f, agenda: e.target.value }))} />
        </Field>
        <Field label="Outcome" hint="Optional. What came out of it.">
          <Textarea value={form.outcome} onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))} />
        </Field>
        <Field label="Next steps" hint="Optional. What happens next.">
          <Textarea value={form.nextSteps} onChange={(e) => setForm((f) => ({ ...f, nextSteps: e.target.value }))} />
        </Field>
      </div>
    </Dialog>
  )
}
