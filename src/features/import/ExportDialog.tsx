import { useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import {
  useAllEmployees, useAllTimelineEvents, useDepartments, useEmployeeDepartments, useOpportunities, useStates,
} from '@/lib/api'
import { downloadCsv, toCsv } from '@/lib/csv'
import { timelineEventLabel } from '@/lib/timeline-meta'
import { attendeeName } from '@/lib/attendees'
import { abbreviateDepartmentName, workUnitLabel } from '@/features/nodes/department-meta'
import { parseContactNumbers } from '@/features/nodes/contact-numbers'
import { stageLabel } from '@/data/pipeline-stages'
import { cn } from '@/lib/utils'
import type { Employee, HierNode, Opportunity, TimelineEvent } from '@/lib/types'

type DatasetKey = 'departments' | 'people' | 'meetings' | 'opportunities'

const DATASETS: { key: DatasetKey; label: string; icon: string; describe: string }[] = [
  { key: 'departments', label: 'Departments', icon: 'Building2', describe: 'Every department with its state, code, and contact details' },
  { key: 'people', label: 'People', icon: 'Users', describe: 'Every contact with posting, department, and relationship fields' },
  { key: 'meetings', label: 'Meetings & interactions', icon: 'CalendarClock', describe: 'Every logged timeline entry with its person and attendees' },
  { key: 'opportunities', label: 'Opportunities', icon: 'Briefcase', describe: 'Every opportunity with its department, stage, and value' },
]

interface Ctx {
  states: { code: number; name: string }[]
  departments: HierNode[]
  employees: Employee[]
  employeeDepartments: Record<string, { id: string; name: string }>
  events: TimelineEvent[]
  opportunities: Opportunity[]
}

function stateName(ctx: Ctx, code: number | null): string {
  if (code === null) return ''
  return ctx.states.find((s) => s.code === code)?.name ?? String(code)
}

function departmentRows(ctx: Ctx): string[][] {
  return [
    ['State', 'Department', 'Short name', 'Code', 'Website', 'Contact', 'Email', 'Office address', 'Description'],
    ...ctx.departments.map((d) => [
      stateName(ctx, d.stateCode),
      d.name,
      d.metadata.shortName || abbreviateDepartmentName(`Department of ${d.name}`),
      d.code ?? '',
      d.metadata.website ?? '',
      parseContactNumbers(d.metadata.contactNumbers)
        .map((c) => (c.city ? `${c.city}: ${c.number}` : c.number))
        .filter(Boolean)
        .join('; '),
      d.metadata.departmentEmail ?? '',
      d.metadata.officeAddress ?? '',
      d.metadata.description ?? '',
    ]),
  ]
}

function peopleRows(ctx: Ctx): string[][] {
  const nameById = new Map(ctx.employees.map((e) => [e.id, e.name] as const))
  return [
    [
      'Name', 'Designation', 'Department', 'Email', 'Phone', 'Company', 'Address', 'Website',
      'Vacant', 'Connected', 'Relationship status', 'Relationship quality', 'Important contact',
      'Preferred contact', 'Reports to', 'Last interaction', 'Next follow-up', 'Notes',
    ],
    ...ctx.employees.map((e) => [
      e.name,
      e.designation,
      ctx.employeeDepartments[e.id]?.name ?? '',
      e.email,
      e.phone,
      e.company,
      e.address,
      e.website,
      e.vacant ? 'yes' : 'no',
      e.connected ? 'yes' : 'no',
      e.connected ? e.relationshipStatus : '',
      e.connected ? e.relationshipQuality : '',
      e.importantContact ? 'yes' : 'no',
      e.preferredComm.join('; '),
      e.managerId ? nameById.get(e.managerId) ?? '' : '',
      e.lastInteractionAt ?? '',
      e.followUpDate ?? '',
      e.notes,
    ]),
  ]
}

function meetingRows(ctx: Ctx): string[][] {
  const empById = new Map(ctx.employees.map((e) => [e.id, e] as const))
  return [
    ['Date', 'Time', 'Type', 'Title', 'Person', 'Designation', 'Department', 'Attendees', 'Attended', 'Source', 'Note'],
    ...ctx.events.map((t) => {
      const emp = empById.get(t.employeeId)
      return [
        t.date,
        t.time ?? '',
        timelineEventLabel(t),
        t.title,
        emp?.name ?? '',
        emp?.designation ?? '',
        emp ? ctx.employeeDepartments[emp.id]?.name ?? '' : '',
        (t.attendees ?? []).map(attendeeName).join('; '),
        t.attended === undefined ? '' : t.attended ? 'yes' : 'no',
        t.source,
        t.note,
      ]
    }),
  ]
}

function opportunityRows(ctx: Ctx): string[][] {
  const deptById = new Map(ctx.departments.map((d) => [d.id, d] as const))
  return [
    [
      'Opportunity', 'Department', 'Department ID', 'State', 'Stage', 'Closed on', 'GEM / Tender ID',
      'Vertical', 'Component', 'Quantity', 'Publish date', 'Submission date', 'Currency', 'Value',
      'Value unit', 'Budget confirmed', 'EMD amount', 'EMD unit', 'Sales person', 'Created at',
    ],
    ...ctx.opportunities.map((o) => [
      o.opportunityName,
      deptById.get(o.departmentId)?.name ?? '',
      o.departmentId,
      stateName(ctx, o.stateCode),
      stageLabel(o.stageKey),
      o.closedOn ?? '',
      o.gemTenderId,
      o.vertical,
      o.component.join('; '),
      o.quantity,
      o.publishDate,
      o.submissionDate,
      o.currency,
      o.valueAmount,
      workUnitLabel(o.valueUnit),
      o.budgetKnown === 'yes' ? 'Yes' : o.budgetKnown === 'no' ? 'No' : '',
      o.emdAmount,
      workUnitLabel(o.emdUnit),
      o.salesPersonEmail,
      o.createdAt,
    ]),
  ]
}

const BUILDERS: Record<DatasetKey, (ctx: Ctx) => string[][]> = {
  departments: departmentRows,
  people: peopleRows,
  meetings: meetingRows,
  opportunities: opportunityRows,
}

/** Bulk CSV export, the read counterpart to `ImportDialog`. Pick one or more
 *  datasets and each downloads as its own CSV — separate files rather than one
 *  merged sheet, since the three have entirely different column sets. */
export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [selected, setSelected] = useState<DatasetKey[]>(['departments'])
  const [stateCode, setStateCode] = useState<number | null>(null)

  const { data: states = [] } = useStates()
  const { data: departments = [] } = useDepartments()
  const { data: employees = [] } = useAllEmployees()
  const { data: employeeDepartments = {} } = useEmployeeDepartments()
  const { data: events = [] } = useAllTimelineEvents()
  const { data: opportunities = [] } = useOpportunities()

  // Scoping to a state filters departments by their own stateCode, and people
  // (plus their meetings) by the department they sit under — so a state export
  // never carries rows belonging to another state.
  const scopedDepartments = stateCode === null ? departments : departments.filter((d) => d.stateCode === stateCode)
  const scopedDeptIds = new Set(scopedDepartments.map((d) => d.id))
  const scopedEmployees = stateCode === null
    ? employees
    : employees.filter((e) => {
      const dept = employeeDepartments[e.id]
      return dept ? scopedDeptIds.has(dept.id) : false
    })
  const scopedEmployeeIds = new Set(scopedEmployees.map((e) => e.id))
  const scopedEvents = stateCode === null ? events : events.filter((t) => scopedEmployeeIds.has(t.employeeId))
  const scopedOpportunities = stateCode === null ? opportunities : opportunities.filter((o) => o.stateCode === stateCode)

  const ctx: Ctx = {
    states, departments: scopedDepartments, employees: scopedEmployees, employeeDepartments, events: scopedEvents,
    opportunities: scopedOpportunities,
  }

  const COUNTS: Record<DatasetKey, number> = {
    departments: scopedDepartments.length,
    people: scopedEmployees.length,
    meetings: scopedEvents.length,
    opportunities: scopedOpportunities.length,
  }

  function toggle(key: DatasetKey) {
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]))
  }

  async function submit() {
    if (selected.length === 0) return
    const scope = stateCode === null ? 'all-states' : stateName(ctx, stateCode).toLowerCase().replace(/\s+/g, '-')
    try {
      for (const key of selected) {
        const rows = BUILDERS[key](ctx)
        // Header-only means nothing matched the scope — skipped so the user
        // doesn't get a file that looks like data but has none.
        if (rows.length <= 1) continue
        await downloadCsv(`gorms-${key}-${scope}.csv`, toCsv(rows))
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed')
      return
    }
    const total = selected.reduce((n, k) => n + COUNTS[k], 0)
    toast(total === 0 ? 'Nothing to export for this scope' : `Exported ${total} rows across ${selected.length} file${selected.length === 1 ? '' : 's'}`)
    onClose()
  }

  const totalRows = selected.reduce((n, k) => n + COUNTS[k], 0)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export records"
      description="Download the current data as CSV. Each dataset comes down as its own file."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={selected.length === 0 || totalRows === 0}>
            <Icon name="Download" size={14} />
            {totalRows > 0 ? `Export ${totalRows} rows` : 'Export'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Scope" hint="Limits every selected dataset to one state's records.">
          <Select value={stateCode ?? ''} onChange={(e) => setStateCode(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All states</option>
            {states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </Select>
        </Field>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-[11px] uppercase tracking-wide text-muted">What to export</legend>
          {DATASETS.map((d) => {
            const checked = selected.includes(d.key)
            const count = COUNTS[d.key]
            return (
              <label
                key={d.key}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                  checked ? 'border-ink-600 bg-panel/60' : 'border-line hover:border-ink-600',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(d.key)}
                  className="mt-0.5 accent-ink-900"
                />
                <Icon name={d.icon} size={16} className="mt-0.5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink-900">{d.label}</span>
                    <span className="font-mono text-[11px] text-muted">{count} rows</span>
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted">{d.describe}</span>
                </span>
              </label>
            )
          })}
        </fieldset>

        {selected.length > 0 && totalRows === 0 && (
          <p className="flex items-center gap-1.5 text-[12px] text-amber-600">
            <Icon name="TriangleAlert" size={13} /> Nothing matches this scope yet — pick another state or dataset.
          </p>
        )}
      </div>
    </Dialog>
  )
}
