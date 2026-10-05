import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  useAllEmployees, useCurrentPostings, useDepartments, useOpportunities, useOwnedBy, useSalesPerson,
  useSalesPersonMutations, useSalesPersons, useSalesPostings,
} from '@/lib/api'
import { liveSalesRoster, resolveSalesChain } from '@/data/sales-hierarchy'
import { useWorkspace } from '@/features/workspace/context'
import { useSalesEditLock } from '@/features/sales/salesEditLock'
import { useToast } from '@/components/ui/Toast'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { Avatar, type AvatarPerson } from '@/components/ui/Avatar'
import { PersonName } from '@/components/ui/PersonName'
import { Icon } from '@/components/ui/Icon'
import { Menu, MenuDivider, MenuItem } from '@/components/ui/Menu'
import { Tooltip } from '@/components/ui/Tooltip'
import { tierLabel } from '@/data/sales-tiers'
import { displayEndDate } from '@/lib/intervals'
import { isoToday } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { SalesPersonFormDialog } from '@/features/sales/SalesPersonFormDialog'
import { EditPostingDatesDialog } from '@/features/sales/EditPostingDatesDialog'
import { TransferBookOfBusinessDialog } from '@/features/sales/TransferBookOfBusinessDialog'
import { TransferSalesPersonDialog } from '@/features/sales/TransferSalesPersonDialog'
import type { SalesPerson } from '@/lib/types'

/** Statuses where a person typically stops actively working their book of
 *  business — marking one of these prompts the bulk hand-off dialog rather
 *  than leaving departments/contacts/opportunities pointed at someone who
 *  isn't around to work them. */
const HANDOFF_STATUSES: SalesPerson['status'][] = ['onLeave', 'resigned', 'inactive']

const STATUS_LABEL: Record<SalesPerson['status'], string> = {
  active: 'Active', onLeave: 'On leave', resigned: 'Resigned', inactive: 'Inactive',
}

const STATUS_TONE: Record<SalesPerson['status'], BadgeTone> = {
  active: 'emerald', onLeave: 'amber', resigned: 'gray', inactive: 'gray',
}

/** Small uppercase label used to separate the Actions menu into groups
 *  (Career / Ownership / Status / Danger Zone) — plain text, not an
 *  interactive item, matching the group-label style used elsewhere
 *  (e.g. the Book of Business subgroup headers below). */
function MenuGroupLabel({ children }: { children: string }) {
  return <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</p>
}

function Row({ label, value, icon }: { label: string; value: ReactNode; icon: string }) {
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
  const { data: currentPostings = {} } = useCurrentPostings()
  const { data: owned = [] } = useOwnedBy(salesPersonId, isoToday())
  const { data: departments = [] } = useDepartments()
  const { data: employees = [] } = useAllEmployees()
  const { data: opportunities = [] } = useOpportunities()
  const { setStatus, remove } = useSalesPersonMutations()
  const [editOpen, setEditOpen] = useState(false)
  const [postingTransferOpen, setPostingTransferOpen] = useState(false)
  const [datesOpen, setDatesOpen] = useState(false)
  const [bobTransferOpen, setBobTransferOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const { unlocked } = useSalesEditLock()

  if (!person) {
    return <p className="p-4 text-sm text-muted">This salesperson no longer exists.</p>
  }

  const current = postings.find((p) => p.endDate === null)
  // The posting whose dates the "Edit dates" action targets: the current one,
  // or — once it has been ended — the most recent one, so an ended posting can
  // be corrected or reopened instead of stranding the person with no way back.
  const latest = [...postings].sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
  const editable = current ?? latest
  const manager = current?.managerId ? people.find((p) => p.id === current.managerId) : undefined
  // Item 1: GM/Higher Reporting Manager — an explicit override on the
  // current posting wins, otherwise it's derived by walking one level
  // further up the manager chain from the RM (same derivation
  // SalesPersonFormDialog's disabled-by-default field shows).
  const gmOverride = current?.gmOverrideId ? people.find((p) => p.id === current.gmOverrideId) : undefined
  const derivedGm = manager ? resolveSalesChain(manager.officialEmail, liveSalesRoster(people, currentPostings)).gm : undefined
  const gmName = gmOverride?.name ?? derivedGm?.name
  // The roster entry carries no photo — resolve back to the full record for the face.
  const gmPerson = gmOverride ?? (derivedGm ? people.find((p) => p.officialEmail === derivedGm.email) : undefined)
  const managerValue = manager ? <PersonName person={manager} /> : '—'
  const gmValue = gmName ? <PersonName person={{ name: gmName, photoUrl: gmPerson?.photoUrl }} /> : '—'
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-4">
        <Avatar person={{ name: person.name, photoUrl: person.photoUrl }} size="md" />
        {/* Wraps (never ellipsizes) so the full name is always readable; the
            basis keeps it from being squeezed below ~9rem before the action
            buttons drop to their own line instead. */}
        <div className="min-w-0 flex-1 basis-36">
          <h2 className="break-words text-base font-semibold leading-snug text-ink-900">{person.name}</h2>
          <p className="break-words text-[13px] leading-snug text-muted">{current?.designation || 'No current posting'}</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
        <Tooltip label={unlocked ? 'Edit' : 'Unlock editing to make changes'}>
          <Button size="sm" disabled={!unlocked} onClick={() => setEditOpen(true)}><Icon name="Pencil" size={14} /> Edit</Button>
        </Tooltip>
        <Menu
          align="end"
          trigger={({ open, toggle }) => (
            <Tooltip label={unlocked ? 'More actions' : 'Unlock editing to use these actions'}>
              <Button
                size="icon" variant="ghost" aria-label="More actions" aria-haspopup="menu" aria-expanded={open}
                disabled={!unlocked}
                onClick={toggle} className={cn(open && 'bg-ink-900/[0.05] text-ink')}
              >
                <Icon name="MoreHorizontal" size={16} />
              </Button>
            </Tooltip>
          )}
        >
          {(close) => (
            <>
              <MenuGroupLabel>Career</MenuGroupLabel>
              <MenuItem
                icon={<Icon name="ArrowLeftRight" size={15} />}
                onClick={() => { close(); setPostingTransferOpen(true) }}
              >
                Change posting
              </MenuItem>

              <MenuDivider />
              <MenuGroupLabel>Ownership</MenuGroupLabel>
              <MenuItem
                icon={<Icon name="Briefcase" size={15} />}
                onClick={() => { close(); setBobTransferOpen(true) }}
              >
                Transfer book of business
              </MenuItem>

              <MenuDivider />
              <MenuGroupLabel>Status</MenuGroupLabel>
              {(['active', 'onLeave', 'resigned', 'inactive'] as const)
                .filter((s) => s !== person.status)
                .map((s) => (
                  <MenuItem
                    key={s}
                    icon={<Icon name="CircleDot" size={15} />}
                    onClick={async () => {
                      close()
                      await setStatus.mutateAsync({ id: person.id, status: s })
                      toast(`Marked ${STATUS_LABEL[s]}`)
                      // Prompt the hand-off immediately for statuses where the
                      // person stops working their book — waiting for the user
                      // to remember a separate step is how things get orphaned.
                      if (HANDOFF_STATUSES.includes(s) && owned.some((a) => a.role === 'owner')) {
                        setBobTransferOpen(true)
                      }
                    }}
                  >
                    Mark {STATUS_LABEL[s]}
                  </MenuItem>
                ))}

              <MenuDivider />
              <MenuGroupLabel>Danger Zone</MenuGroupLabel>
              <MenuItem
                icon={<Icon name="Trash2" size={15} />}
                danger
                onClick={() => { close(); setDeleteOpen(true) }}
              >
                Remove
              </MenuItem>
            </>
          )}
        </Menu>
        </div>
      </div>

      <div className="px-4 py-3">
        <h3 className="mb-2 text-[13px] font-semibold text-ink-900">Details</h3>
        <div className="space-y-3.5">
          <div>
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Contact</p>
            <dl>
              <Row label="Official email" value={person.officialEmail || '—'} icon="Mail" />
              <Row label="Mobile" value={person.mobile || '—'} icon="Phone" />
            </dl>
          </div>

          <div>
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Role</p>
            <dl>
              <Row label="Designation" value={current?.designation || '—'} icon="IdCard" />
              <Row label="Tier" value={current ? tierLabel(current.tierKey) : '—'} icon="Layers" />
              <Row label="Reporting manager" value={managerValue} icon="Network" />
              <Row label="GM / Higher Reporting Manager" value={gmValue} icon="Network" />
            </dl>
          </div>

          <div>
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Status</p>
            <div className="flex items-start gap-2.5 py-1.5">
              <Icon name="CircleDot" size={14} className="mt-0.5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-wide text-muted">Status</div>
                <Badge tone={STATUS_TONE[person.status]} className="mt-0.5">{STATUS_LABEL[person.status]}</Badge>
              </div>
            </div>
            <dl>
              <Row label="Join date" value={person.joinedOn || '—'} icon="Calendar" />
              <Row label="Leave date" value={person.leftOn || '—'} icon="Calendar" />
            </dl>
          </div>

          {person.notes && (
            <div>
              <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Notes</p>
              <dl><Row label="Notes" value={person.notes} icon="StickyNote" /></dl>
            </div>
          )}
        </div>
      </div>

      {/* The blob store (blobs.ts) exists, but no upload flow is wired to
          SalesPerson yet — VisitingCard.tsx is the closest analog and is
          built entirely against Employee fields, so there's nothing to reuse
          without adding SalesPerson fields/repository methods, which is out
          of scope for this pass. Buttons stay visible (not hidden) so the
          intended shape reads as "coming soon", not broken. */}
      <div className="border-t border-line px-4 py-3">
        <h3 className="mb-1 text-[13px] font-semibold text-ink-900">Attachments</h3>
        <p className="mb-2 text-[12px] text-muted">No attachments uploaded.</p>
        <div className="flex flex-col gap-1.5">
          <Button size="sm" disabled className="justify-between">
            <span className="flex items-center gap-2"><Icon name="Camera" size={14} /> Upload Profile Photo</span>
            <Badge tone="gray">Coming Soon</Badge>
          </Button>
          <Button size="sm" disabled className="justify-between">
            <span className="flex items-center gap-2"><Icon name="IdCard" size={14} /> Upload Visiting Card</span>
            <Badge tone="gray">Coming Soon</Badge>
          </Button>
          <Button size="sm" disabled className="justify-between">
            <span className="flex items-center gap-2"><Icon name="FileText" size={14} /> Upload Documents</span>
            <Badge tone="gray">Coming Soon</Badge>
          </Button>
        </div>
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-ink-900">Posting</h3>
          {editable && (
            <Tooltip label={unlocked ? 'Edit effective dates' : 'Unlock editing to change dates'}>
              <Button size="sm" variant="ghost" disabled={!unlocked} onClick={() => setDatesOpen(true)}>
                <Icon name="CalendarClock" size={14} /> Edit dates
              </Button>
            </Tooltip>
          )}
        </div>
        {!current ? (
          <p className="text-sm text-muted">
            No current posting.{latest && ` The latest posting ended ${displayEndDate(latest.endDate) ?? ''}.`}
          </p>
        ) : (
          <dl className="mb-2 rounded-lg border border-line bg-panel/30 px-2.5">
            <Row label="Designation" value={current.designation || '—'} icon="IdCard" />
            <Row label="Tier" value={tierLabel(current.tierKey) || '—'} icon="Layers" />
            <Row label="Reporting manager" value={managerValue} icon="Network" />
            <Row label="GM / Higher Reporting Manager" value={gmValue} icon="Network" />
            <Row label="Office" value={current.office || '—'} icon="Building2" />
            <Row label="Effective from" value={current.startDate || '—'} icon="CalendarClock" />
            <Row label="Effective to" value={displayEndDate(current.endDate) ?? 'Present'} icon="CalendarClock" />
          </dl>
        )}

        {postings.length > 1 && (
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">History · {postings.length - 1}</p>
            <ul className="flex flex-col gap-1.5">
              {postings.filter((p) => p.id !== current?.id).map((p) => {
                // Storage is exclusive-end; humans read the last day actually held.
                const end = displayEndDate(p.endDate)
                return (
                  <li key={p.id} className="rounded-lg border border-line px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-ink-900">{p.designation || '—'}</span>
                      <span className="shrink-0 rounded-full bg-panel px-2 py-0.5 text-[11px] text-ink-700">
                        {tierLabel(p.tierKey)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">
                      {p.startDate || '—'} — {end ?? 'Present'}
                      {p.changeType !== 'initial' && ` · ${p.changeType}`}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>

      <div className="border-t border-line px-4 py-3">
        <h3 className="mb-2 text-[13px] font-semibold text-ink-900">Book of Business</h3>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <BobCountCard label="Departments" count={byKind.orgNode.length} icon="Building2" />
            <BobCountCard label="Contacts" count={byKind.contact.length} icon="User" />
            <BobCountCard label="Opportunities" count={byKind.opportunity.length} icon="Briefcase" />
          </div>
          {owned.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[12px] text-muted">
              No assignments yet.
            </p>
          ) : (
            <>
              <BookGroup
                label="Departments" rows={byKind.orgNode} emptyMessage="No departments owned"
                nameOf={(id) => deptById.get(id)?.name ?? id}
                onOpen={(id) => ws.select('node', id)}
              />
              <BookGroup
                label="Contacts" rows={byKind.contact} emptyMessage="No contacts yet"
                nameOf={(id) => empById.get(id)?.name ?? id}
                personOf={(id) => {
                  const e = empById.get(id)
                  return { name: e?.name ?? id, photoUrl: e?.photoUrl, vacant: e?.vacant }
                }}
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
            </>
          )}
        </div>
      </div>

      <SalesPersonFormDialog open={editOpen} personId={person.id} onClose={() => setEditOpen(false)} />
      <EditPostingDatesDialog open={datesOpen} person={person} posting={editable ?? null} onClose={() => setDatesOpen(false)} />
      <TransferSalesPersonDialog open={postingTransferOpen} person={person} onClose={() => setPostingTransferOpen(false)} />
      <TransferBookOfBusinessDialog open={bobTransferOpen} person={person} onClose={() => setBobTransferOpen(false)} />
      <ConfirmDeleteDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        itemLabel={person.name}
        onConfirm={async () => {
          await remove.mutateAsync(person.id)
          toast(`Removed ${person.name}`)
          ws.clearSelection()
        }}
      />
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

function BookGroup({ label, rows, nameOf, personOf, onOpen, emptyMessage }: {
  label: string
  rows: { id: string; entityId: string; role: string }[]
  nameOf: (entityId: string) => string
  /** Set only for groups whose rows are people (contacts) — adds their face. */
  personOf?: (entityId: string) => AvatarPerson
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
              {personOf ? (
                <PersonName person={personOf(a.entityId)} className="flex-1 text-[13px] text-ink-900" />
              ) : (
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-900">{nameOf(a.entityId)}</span>
              )}
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
