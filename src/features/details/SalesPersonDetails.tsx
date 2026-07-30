import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  useAllEmployees, useDepartments, useOpportunities, useOwnedBy, useSalesPerson, useSalesPersonMutations,
  useSalesPersons, useSalesPostings,
} from '@/lib/api'
import { useWorkspace } from '@/features/workspace/context'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { tierLabel } from '@/data/sales-tiers'
import { displayEndDate } from '@/lib/intervals'
import { isoToday } from '@/lib/dates'
import { cn, initials } from '@/lib/utils'
import { SalesPersonFormDialog } from '@/features/sales/SalesPersonFormDialog'
import type { SalesPerson } from '@/lib/types'

const STATUS_LABEL: Record<SalesPerson['status'], string> = {
  active: 'Active', onLeave: 'On leave', resigned: 'Resigned', inactive: 'Inactive',
}

function Row({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Icon name={icon} size={14} className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
        <div className="break-words text-sm text-ink-900">{value}</div>
      </div>
    </div>
  )
}

/** Quick-peek for a salesperson, shown in the shared details panel. The full
 *  six-tab profile is a dedicated route (spec §5.4) — a six-tab profile does
 *  not fit a 380px aside — and arrives with the rest of Phase 1. */
export function SalesPersonDetails({ salesPersonId }: { salesPersonId: string }) {
  const ws = useWorkspace()
  const toast = useToast()
  const { data: person } = useSalesPerson(salesPersonId)
  const { data: postings = [] } = useSalesPostings(salesPersonId)
  const { data: people = [] } = useSalesPersons()
  const { data: owned = [] } = useOwnedBy(salesPersonId, isoToday())
  const { data: departments = [] } = useDepartments()
  const { data: employees = [] } = useAllEmployees()
  const { data: opportunities = [] } = useOpportunities()
  const { setStatus, remove } = useSalesPersonMutations()
  const [editOpen, setEditOpen] = useState(false)

  if (!person) {
    return <p className="p-4 text-sm text-muted">This salesperson no longer exists.</p>
  }

  const current = postings.find((p) => p.endDate === null)
  const manager = current?.managerId ? people.find((p) => p.id === current.managerId) : undefined
  const deptById = new Map(departments.map((d) => [d.id, d]))
  const empById = new Map(employees.map((e) => [e.id, e]))
  const oppById = new Map(opportunities.map((o) => [o.id, o]))

  // Book of Business, split by entity kind (spec: departments / contacts /
  // opportunities as separate groups) rather than one flat list.
  const byKind = {
    orgNode: owned.filter((a) => a.entityType === 'orgNode'),
    contact: owned.filter((a) => a.entityType === 'contact'),
    opportunity: owned.filter((a) => a.entityType === 'opportunity'),
  }

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center gap-3 border-b border-line px-4 py-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-panel text-sm font-semibold text-ink-700">
          {initials(person.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-ink-900">{person.name}</h2>
          <p className="truncate text-[13px] text-muted">{current?.designation || 'No current posting'}</p>
        </div>
        <Button size="sm" onClick={() => setEditOpen(true)}><Icon name="Pencil" size={14} /> Edit</Button>
        <Menu
          align="end"
          trigger={({ open, toggle }) => (
            <Button
              size="icon" variant="ghost" aria-label="More actions" aria-haspopup="menu" aria-expanded={open}
              onClick={toggle} className={cn(open && 'bg-ink-900/[0.05] text-ink')}
            >
              <Icon name="MoreHorizontal" size={16} />
            </Button>
          )}
        >
          {(close) => (
            <>
              {(['active', 'onLeave', 'resigned', 'inactive'] as const)
                .filter((s) => s !== person.status)
                .map((s) => (
                  <MenuItem
                    key={s}
                    icon={<Icon name="CircleDot" size={15} />}
                    onClick={async () => { close(); await setStatus.mutateAsync({ id: person.id, status: s }); toast(`Marked ${STATUS_LABEL[s]}`) }}
                  >
                    Mark {STATUS_LABEL[s]}
                  </MenuItem>
                ))}
              <MenuItem
                icon={<Icon name="Trash2" size={15} />}
                danger
                onClick={async () => {
                  close()
                  await remove.mutateAsync(person.id)
                  toast(`Removed ${person.name}`)
                  ws.clearSelection()
                }}
              >
                Remove
              </MenuItem>
            </>
          )}
        </Menu>
      </div>

      <div className="px-4 py-3">
        <h3 className="mb-1 text-[13px] font-semibold text-ink-900">Details</h3>
        <dl>
          <Row label="Official email" value={person.officialEmail} icon="Mail" />
          {person.mobile && <Row label="Mobile" value={person.mobile} icon="Phone" />}
          {current && <Row label="Tier" value={tierLabel(current.tierKey)} icon="Layers" />}
          {manager && <Row label="Reports to" value={manager.name} icon="Network" />}
          <Row label="Status" value={STATUS_LABEL[person.status]} icon="CircleDot" />
          {person.notes && <Row label="Notes" value={person.notes} icon="StickyNote" />}
        </dl>
      </div>

      {/* Placeholder — the real attachment store (blobs.ts) exists from Phase
          0 but no upload UI is wired to SalesPerson in this demo slice. */}
      <div className="border-t border-line px-4 py-3">
        <h3 className="mb-1 text-[13px] font-semibold text-ink-900">Attachments</h3>
        <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[12px] text-muted">
          Photo and document uploads arrive later in Phase 1.
        </p>
      </div>

      <div className="border-t border-line px-4 py-3">
        <h3 className="mb-1 text-[13px] font-semibold text-ink-900">
          {postings.length > 1 ? `Postings · ${postings.length}` : 'Posting'}
        </h3>
        {postings.length === 0 ? (
          <p className="text-sm text-muted">No postings recorded.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {postings.map((p) => {
              // Storage is exclusive-end; humans read the last day actually held.
              const end = displayEndDate(p.endDate)
              return (
                <li key={p.id} className="rounded-lg border border-line px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-ink-900">{p.designation}</span>
                    <span className="shrink-0 rounded-full bg-panel px-2 py-0.5 text-[11px] text-ink-700">
                      {tierLabel(p.tierKey)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {p.startDate || 'Start unknown'} — {end ?? 'current'}
                    {p.changeType !== 'initial' && ` · ${p.changeType}`}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-line px-4 py-3">
        <h3 className="mb-2 text-[13px] font-semibold text-ink-900">Book of Business</h3>
        {owned.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[12px] text-muted">
            Nothing directly assigned as of today.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              <BobCountCard label="Departments" count={byKind.orgNode.length} icon="Building2" />
              <BobCountCard label="Contacts" count={byKind.contact.length} icon="User" />
              <BobCountCard label="Opportunities" count={byKind.opportunity.length} icon="Briefcase" />
            </div>
            <BookGroup
              label="Departments" rows={byKind.orgNode} emptyMessage="No departments owned"
              nameOf={(id) => deptById.get(id)?.name ?? id}
              onOpen={(id) => ws.select('node', id)}
            />
            <BookGroup
              label="Contacts" rows={byKind.contact} emptyMessage="No contacts yet"
              nameOf={(id) => empById.get(id)?.name ?? id}
              onOpen={(id) => ws.select('employee', id)}
            />
            <BookGroup
              label="Opportunities" rows={byKind.opportunity} emptyMessage="No opportunities assigned"
              nameOf={(id) => oppById.get(id)?.opportunityName ?? id}
              onOpen={(id) => {
                const dept = oppById.get(id)?.departmentId
                if (dept) ws.select('node', dept)
              }}
            />
          </div>
        )}
      </div>

      <SalesPersonFormDialog open={editOpen} personId={person.id} onClose={() => setEditOpen(false)} />
    </motion.div>
  )
}

function BobCountCard({ label, count, icon }: { label: string; count: number; icon: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-line bg-panel/50 px-2 py-2.5 text-center">
      <Icon name={icon} size={14} className="mb-0.5 text-muted" />
      <span className="text-lg font-semibold leading-none text-ink-900">{count}</span>
      <span className="text-[10px] text-muted">{label}</span>
    </div>
  )
}

/** Shows the first few rows, with "View all" expanding the rest in place —
 *  a Book of Business can run to dozens of opportunities, and a full list by
 *  default buries the summary counts above it. */
const COLLAPSED_ROWS = 3

function BookGroup({ label, rows, nameOf, onOpen, emptyMessage }: {
  label: string
  rows: { id: string; entityId: string; role: string }[]
  nameOf: (entityId: string) => string
  onOpen: (entityId: string) => void
  emptyMessage: string
}) {
  const [expanded, setExpanded] = useState(false)
  if (rows.length === 0) {
    return (
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">{label}</p>
        <p className="rounded-lg border border-dashed border-line px-2.5 py-2 text-[12px] text-muted">{emptyMessage}</p>
      </div>
    )
  }
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS)
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">{label} · {rows.length}</p>
      <ul className="flex flex-col gap-1">
        {visible.map((a) => (
          <li key={a.id}>
            <button
              onClick={() => onOpen(a.entityId)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-2 text-left transition-colors hover:bg-panel"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-900">{nameOf(a.entityId)}</span>
              {a.role !== 'owner' && (
                <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] text-sky-800">delegate</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {rows.length > COLLAPSED_ROWS && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[12px] font-medium text-ink-600 hover:text-ink-900"
        >
          {expanded ? 'Show less' : `View all ${rows.length} →`}
        </button>
      )}
    </div>
  )
}
