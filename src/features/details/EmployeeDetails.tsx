import { Can } from '@/lib/permissions'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  useAllEmployees, useBreadcrumb, useCurrentPostings, useDirectReports, useEmployee, useEmployeeDepartments,
  useEmployeeMutations, useFollowUps, useNode, useReportingChain, useSalesPersons, useTimeline, useTransfers,
} from '@/lib/api'
import { useWorkspace } from '@/features/workspace/context'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { Dialog } from '@/components/ui/Dialog'
import { Menu, MenuItem, MenuDivider } from '@/components/ui/Menu'
import { FitText } from '@/components/ui/FitText'
import {
  Badge, ChargeBadge, ConnectionBadge, ImportantBadge, QualityBadge, StatusBadge, VacantBadge,
} from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import { VisitingCard } from '@/features/employees/VisitingCard'
import { TimelineEventDialog } from '@/features/employees/TimelineEventDialog'
import { TransferDialog } from '@/features/employees/TransferDialog'
import { ChargeDialog } from '@/features/employees/ChargeDialog'
import { EmployeeFormDialog } from '@/features/employees/EmployeeFormDialog'
import { MarkDuplicateDialog } from '@/features/employees/MarkDuplicateDialog'
import { MergeEmployeesDialog } from '@/features/employees/MergeEmployeesDialog'
import { findCandidatesFor } from '@/features/employees/duplicate-detection'
import { AddReporteeMenu } from '@/features/employees/AddReporteeMenu'
import { resolveDepartment } from '@/features/employees/resolveDepartment'
import { abbreviateDepartmentName } from '@/features/nodes/department-meta'
import { MEETING_LOG_TYPES, TIMELINE_META, timelineEventLabel } from '@/lib/timeline-meta'
import { attendeeName, attendeeSalesPersonId } from '@/lib/attendees'
import { useDismissedDuplicatePairs } from '@/lib/dismissed-pairs'
import { cn } from '@/lib/utils'
import { useResolvedOwners } from '@/lib/api'
import { OwnershipBlock } from '@/features/sales/OwnershipBlock'
import { isoToday } from '@/lib/dates'
import { Avatar } from '@/components/ui/Avatar'
import { PersonName } from '@/components/ui/PersonName'
import type { Charge, Employee, TimelineEvent, Transfer } from '@/lib/types'

const COMM_LABEL: Record<string, string> = {
  phone: 'Phone', email: 'Email', whatsapp: 'WhatsApp', 'in-person': 'In person', sms: 'SMS',
}

export function EmployeeDetails({ employeeId }: { employeeId: string }) {
  const ws = useWorkspace()
  const toast = useToast()
  // Arriving from Meetings.tsx (`?highlight=<entryId>`) — points at the exact
  // timeline row that was clicked, so this page shows more than just "some
  // employee's profile" for that click.
  const [searchParams] = useSearchParams()
  const highlightEntryId = searchParams.get('highlight')
  const { remove, removeCharge, setManager, setTimelineEventAttended, update } = useEmployeeMutations()
  const { data: emp } = useEmployee(employeeId)
  const { data: chain = [] } = useReportingChain(employeeId)
  const { data: reports = [] } = useDirectReports(employeeId)
  const { data: orgNode } = useNode(emp?.orgNodeId ?? null)
  const { data: trail = [] } = useBreadcrumb(emp?.orgNodeId ?? null)
  const { data: timeline = [] } = useTimeline(employeeId)
  const { data: transfers = [] } = useTransfers(employeeId)
  const { data: followUps = [] } = useFollowUps('contact', employeeId)
  const openFollowUps = followUps.filter((f) => f.status === 'open')
  const [cardOpen, setCardOpen] = useState(false)
  const [active, setActive] = useState<'none' | 'event' | 'transfer' | 'charge'>('none')
  // Item 14: separate from `active` because it carries the full record being
  // edited, not just a mode flag — the dialog seeds every field from it.
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null)
  const [reporteeMode, setReporteeMode] = useState<'junior' | 'manager' | null>(null)
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false)
  const [mergeCandidateId, setMergeCandidateId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [chargeToRemove, setChargeToRemove] = useState<Charge | null>(null)
  // Resolves to `undefined` when unset (query disabled) or when the flagged-to
  // employee no longer exists (deleted) — either way the banner below just
  // doesn't render, no error state.
  const { data: duplicateOfEmp } = useEmployee(emp?.metadata.duplicateOf || null)
  const { data: allEmployees = [] } = useAllEmployees()
  const { data: departmentOf = {} } = useEmployeeDepartments()
  const { isDismissed, dismiss } = useDismissedDuplicatePairs()

  // Auto-detected suggestion (name/email/phone/department match) — distinct
  // from the manual `metadata.duplicateOf` flag above. Suppressed once the
  // top match is the same person the manual flag already points at (that
  // banner already covers it) or once the user's said "not a duplicate".
  const topAutoMatch = useMemo(() => {
    if (!emp) return null
    const candidates = findCandidatesFor(emp, allEmployees, { departmentOf })
      .filter((c) => !isDismissed(c.a.id, c.b.id) && c.b.id !== duplicateOfEmp?.id)
    return candidates[0] ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emp, allEmployees, departmentOf, isDismissed, duplicateOfEmp?.id])
  const mergeCandidate = mergeCandidateId
    ? allEmployees.find((e) => e.id === mergeCandidateId) ?? null
    : null

  const { data: contactOwners = {} } = useResolvedOwners('contact', emp ? [emp.id] : [], isoToday())
  const { data: salesPersons = [] } = useSalesPersons()
  const { data: currentPostings = {} } = useCurrentPostings()

  if (!emp) return null
  const vacant = emp.vacant
  const department = trail.find((t) => t.typeKey === 'department')
  // Item 4: Website/Address belong to the department, not the employee — the
  // form no longer collects them (EmployeeFormDialog), so this resolves the
  // employee's NEAREST department ancestor (same helper/semantics as Item 3's
  // Company auto-fill, so a nested Department → Department posting inherits
  // from the department it's actually posted under, not some outer one) and
  // prefers its metadata over the employee's own (possibly stale) legacy
  // field — which only still shows for old records whose department has no
  // value of its own, never alongside a department value.
  const nearestDepartment = orgNode ? resolveDepartment(orgNode, trail) : null
  const website = nearestDepartment?.metadata.website || emp.website
  const officeAddress = nearestDepartment?.metadata.officeAddress || emp.address
  const relationshipOwner = salesPersons.find((p) => p.officialEmail === emp.metadata.relationshipOwner)

  async function unflagDuplicate() {
    const { duplicateOf: _dropped, ...rest } = emp!.metadata
    await update.mutateAsync({ id: emp!.id, patch: { metadata: rest } })
    toast('Unflagged')
  }

  return (
    <motion.div
      key={employeeId}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="flex h-full flex-col"
    >
      <div className="border-b border-line px-6 py-5">
        <nav className="mb-3 flex flex-wrap items-center gap-1 text-[12px] text-muted">
          {trail.map((t, i) => (
            <span key={t.id} className="flex items-center gap-1">
              {i > 0 && <Icon name="ChevronRight" size={12} className="text-line" />}
              <button onClick={() => ws.select('node', t.id)} className="rounded px-1 hover:text-ink">{t.name}</button>
            </span>
          ))}
        </nav>

        {duplicateOfEmp && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-600/40 bg-amber-100/40 px-3 py-2 text-[13px] text-ink-800">
            <Icon name="Copy" size={14} className="shrink-0 text-amber-600" />
            <span className="min-w-0 flex-1">
              Possible duplicate of{' '}
              <button onClick={() => ws.select('employee', duplicateOfEmp.id)} className="inline-flex items-center gap-1.5 align-middle font-semibold hover:underline">
                <Avatar person={duplicateOfEmp} size="xs" />
                {duplicateOfEmp.name}
              </button>
            </span>
            <button onClick={unflagDuplicate} className="shrink-0 text-[12px] font-medium text-teal-600 hover:underline">
              Unflag
            </button>
          </div>
        )}

        {!duplicateOfEmp && topAutoMatch && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-600/40 bg-amber-100/40 px-3 py-2 text-[13px] text-ink-800">
            <Icon name="Copy" size={14} className="shrink-0 text-amber-600" />
            <span className="min-w-0 flex-1">
              This might be the same person as{' '}
              <button onClick={() => ws.select('employee', topAutoMatch.b.id)} className="inline-flex items-center gap-1.5 align-middle font-semibold hover:underline">
                <Avatar person={topAutoMatch.b} size="xs" />
                {topAutoMatch.b.name}
              </button>
              {' '}({topAutoMatch.matchedOn.join(', ').toLowerCase()})
            </span>
            <button onClick={() => setMergeCandidateId(topAutoMatch.b.id)} className="shrink-0 text-[12px] font-medium text-teal-600 hover:underline">
              Review merge
            </button>
            <button onClick={() => dismiss(topAutoMatch.a.id, topAutoMatch.b.id)} className="shrink-0 text-[12px] font-medium text-muted hover:underline">
              Not a duplicate
            </button>
          </div>
        )}

        <div className="flex items-start gap-4">
          <Avatar person={{ name: emp.name, photoUrl: emp.photoUrl, vacant }} size="lg" className="font-display" />
          <div className="min-w-0 flex-1">
            <span className="eyebrow">
              {department
                ? (department.metadata.shortName || abbreviateDepartmentName(`Department of ${department.name}`))
                : (orgNode?.name ?? 'Unassigned')}
            </span>
            <h2 className="mt-0.5 break-words font-display text-2xl font-bold text-ink-900">
              {vacant ? emp.designation || 'Vacant position' : emp.name}
            </h2>
            {!vacant && <p className="text-sm text-muted">{emp.designation}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {vacant ? (
                <VacantBadge />
              ) : (
                <>
                  <ConnectionBadge connected={emp.connected} />
                  {emp.connected && <QualityBadge quality={emp.relationshipQuality} />}
                  {emp.connected && <StatusBadge status={emp.relationshipStatus} />}
                  {emp.importantContact && <ImportantBadge />}
                </>
              )}
              {emp.charges.map((c) => <ChargeBadge key={c.id} charge={c} />)}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {vacant ? (
            <Button variant="primary" size="sm" onClick={() => ws.editEmployee(emp)}>
              <Icon name="UserCheck" size={14} /> Assign person
            </Button>
          ) : (
            <AddReporteeMenu onChoose={setReporteeMode} />
          )}
          <Can module="am.contacts" action="update">
            <Button size="sm" onClick={() => ws.editEmployee(emp)}><Icon name="Pencil" size={14} /> Edit</Button>
          </Can>
          {!vacant && (
            <Can module="am.meetings" action="create">
              <Button size="sm" onClick={() => setActive('event')}><Icon name="Calendar" size={14} /> Add meeting</Button>
            </Can>
          )}

          {/* Less-frequent / destructive actions tucked away so they can't be hit by accident. */}
          <Menu
            align="end"
            trigger={({ open, toggle }) => (
              <Button
                size="icon"
                variant="ghost"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={toggle}
                className={cn(open && 'bg-ink-900/[0.05] text-ink')}
              >
                <Icon name="MoreHorizontal" size={16} />
              </Button>
            )}
          >
            {(close) => (
              <>
                {!vacant && (
                  <>
                    <Can module="am.contacts" action="update">
                      <MenuItem icon={<Icon name="Briefcase" size={15} />} onClick={() => { close(); setActive('charge') }}>
                        Add charge
                      </MenuItem>
                    </Can>
                    <Can module="am.contacts" action="update">
                      <Can module="am.departments" action="update">
                        <MenuItem icon={<Icon name="ArrowLeftRight" size={15} />} onClick={() => { close(); setActive('transfer') }}>
                          Transfer
                        </MenuItem>
                      </Can>
                    </Can>
                    <MenuItem icon={<Icon name="IdCard" size={15} />} onClick={() => { close(); setCardOpen(true) }}>
                      Visiting card
                    </MenuItem>
                    <Can module="am.contacts" action="update">
                      <MenuItem icon={<Icon name="Copy" size={15} />} onClick={() => { close(); setDuplicateDialogOpen(true) }}>
                        Mark as duplicate of…
                      </MenuItem>
                    </Can>
                    <MenuDivider />
                  </>
                )}
                <Can module="am.contacts" action="delete">
                  <MenuItem
                    icon={<Icon name="Trash2" size={15} />}
                    danger
                    onClick={() => { close(); setDeleteOpen(true) }}
                  >
                    Remove
                  </MenuItem>
                </Can>
              </>
            )}
          </Menu>
        </div>
      </div>

      <Dialog open={cardOpen} onClose={() => setCardOpen(false)} title="Visiting card" description={emp.name}>
        <VisitingCard employeeId={emp.id} />
      </Dialog>
      <MarkDuplicateDialog open={duplicateDialogOpen} employee={emp} onClose={() => setDuplicateDialogOpen(false)} />
      {mergeCandidate && (
        <MergeEmployeesDialog
          open={!!mergeCandidate}
          onClose={() => setMergeCandidateId(null)}
          employeeA={emp}
          employeeB={mergeCandidate}
          onMerged={(survivorId) => {
            setMergeCandidateId(null)
            // This record was the one absorbed into the other — follow the
            // selection over to the survivor rather than leaving it pointed
            // at an id that no longer resolves to anything.
            if (survivorId !== emp.id) ws.select('employee', survivorId)
          }}
        />
      )}
      <TimelineEventDialog
        open={active === 'event' || !!editingEvent}
        employeeId={emp.id}
        existingEvent={editingEvent ?? undefined}
        typeFilter={MEETING_LOG_TYPES}
        onClose={() => { setActive('none'); setEditingEvent(null) }}
      />
      <TransferDialog open={active === 'transfer'} employee={emp} onClose={() => setActive('none')} />
      <ChargeDialog open={active === 'charge'} employeeId={emp.id} onClose={() => setActive('none')} />
      <ConfirmDeleteDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        itemLabel={emp.name || 'this vacant position'}
        onConfirm={async () => {
          await remove.mutateAsync(emp.id)
          toast(`Removed ${emp.name || 'vacant position'}`)
          ws.clearSelection()
        }}
      />
      <ConfirmDeleteDialog
        open={!!chargeToRemove}
        onClose={() => setChargeToRemove(null)}
        itemLabel={chargeToRemove?.title ?? 'this charge'}
        onConfirm={async () => {
          if (!chargeToRemove) return
          await removeCharge.mutateAsync({ employeeId: emp.id, chargeId: chargeToRemove.id })
          toast('Charge removed')
        }}
      />
      <EmployeeFormDialog
        open={reporteeMode !== null}
        orgNode={orgNode ?? null}
        employee={null}
        reporteeMode={reporteeMode}
        presetManagerId={reporteeMode === 'junior' ? emp.id : (emp.managerId ?? undefined)}
        onClose={() => setReporteeMode(null)}
        onSaved={async (newId) => {
          if (reporteeMode === 'manager') {
            await setManager.mutateAsync({ employeeId: emp.id, managerId: newId })
            toast(`${emp.name} now reports to the new manager`)
          } else if (reporteeMode === 'junior') {
            await setManager.mutateAsync({ employeeId: newId, managerId: emp.id })
            toast(`Added junior to ${emp.name}`)
          }
          setReporteeMode(null)
          ws.select('employee', newId)
        }}
      />

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto scrollbar-thin px-6 py-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {!vacant && emp.email && (
            <DetailRow label="Email" icon="Mail">
              <a href={`mailto:${emp.email}`} className="hover:underline">{emp.email}</a>
            </DetailRow>
          )}
          {!vacant && emp.phone && (
            <DetailRow label="Phone" icon="Phone">
              <a href={`tel:${emp.phone}`} className="hover:underline">{emp.phone}</a>
            </DetailRow>
          )}
          {!vacant && emp.company && <DetailRow label="Company" value={emp.company} icon="Building2" />}
          {!vacant && website && (
            <DetailRow label="Website" icon="Globe">
              <a
                href={website.startsWith('http') ? website : `https://${website}`}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                {website}
              </a>
            </DetailRow>
          )}
          {!vacant && officeAddress && <DetailRow label="Address" value={officeAddress} icon="MapPin" />}
          {orgNode && <DetailRow label="Posting" value={orgNode.name} icon="Landmark" />}
          {relationshipOwner && (
            <DetailRow label="Relationship Owner / AMNEX Representative" icon="UserCheck">
              <button
                onClick={() => ws.select('salesPerson', relationshipOwner.id)}
                className="flex cursor-pointer items-center gap-1.5 text-left underline decoration-line decoration-1 underline-offset-2 hover:text-ink-700 hover:decoration-ink-600"
              >
                <Avatar person={{ name: relationshipOwner.name, photoUrl: relationshipOwner.photoUrl }} size="xs" />
                {relationshipOwner.name} · {currentPostings[relationshipOwner.id]?.designation || 'No current posting'}
              </button>
            </DetailRow>
          )}
        </dl>

        {!vacant && (
          <Section title="Relationship" icon="Handshake">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {emp.connected && (
                <>
                  <DetailRow label="Quality">
                    <QualityBadge quality={emp.relationshipQuality} />
                  </DetailRow>
                  <DetailRow label="Status"><StatusBadge status={emp.relationshipStatus} /></DetailRow>
                  {emp.relationshipType && <DetailRow label="Type" value={emp.relationshipType} icon="Type" />}
                  {emp.introducedBy && <DetailRow label="Introduced by" value={emp.introducedBy} icon="UserPlus" />}
                </>
              )}
              {emp.preferredComm.length > 0 && (
                <DetailRow
                  label="Preferred contact"
                  value={emp.preferredComm.map((c) => COMM_LABEL[c]).join(', ')}
                  icon="MessageCircle"
                />
              )}
              <DetailRow label="Important contact" value={emp.importantContact ? 'Yes' : 'No'} icon="Star" />
              {emp.lastInteractionAt && <DetailRow label="Last interaction" value={emp.lastInteractionAt} icon="Clock" />}
              {openFollowUps.length > 0
                ? openFollowUps.map((f) => (
                    <DetailRow key={f.id} label="Follow-up" value={f.dueDate} icon="Calendar" />
                  ))
                : emp.followUpDate && <DetailRow label="Next follow-up" value={emp.followUpDate} icon="Calendar" />}
            </dl>
            {emp.notes && (
              <p className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink-800">{emp.notes}</p>
            )}
          </Section>
        )}

        {!vacant && (
          <section className="mb-4 rounded-xl border border-line bg-panel/40 p-3">
            <OwnershipBlock
              entityType="contact"
              entityId={emp.id}
              entityLabel={emp.name}
              owner={contactOwners[emp.id]}
              viaLabel={department?.name}
            />
          </section>
        )}

        {emp.charges.length > 0 && (
          <Section title={`Charges · ${emp.charges.length}`} icon="Briefcase">
            <div className="space-y-2">
              {emp.charges.map((c) => (
                <ChargeRow key={c.id} charge={c} onRemove={() => setChargeToRemove(c)} />
              ))}
            </div>
          </Section>
        )}

        {transfers.length > 0 && (
          <Section title={`Transfers · ${transfers.length}`} icon="ArrowLeftRight">
            <div className="space-y-2">
              {transfers.map((t) => <TransferRow key={t.id} transfer={t} />)}
            </div>
          </Section>
        )}

        {!vacant && (
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink-800">
                <Icon name="Clock" size={14} className="text-muted" /> Timeline · {timeline.length}
              </h3>
              <button onClick={() => setActive('event')} className="text-[12px] font-medium text-teal-600 hover:underline">+ Add meeting</button>
            </div>
            <TimelineList
              events={timeline}
              onSetAttended={(id, attended) => setTimelineEventAttended.mutate({ id, attended })}
              onEdit={setEditingEvent}
              highlightId={highlightEntryId}
            />
          </section>
        )}

        <section>
          <h3 className="mb-3 text-[13px] font-semibold text-ink-800">Reporting line</h3>
          <div className="rounded-card border border-line bg-white p-4">
            <div className="relative">
              {chain.length > 0 && <span className="absolute bottom-5 left-6 top-5 w-px bg-line" aria-hidden="true" />}
              <div className="space-y-1">
                {chain.map((m) => (
                  <ChainRow key={m.id} emp={m} onClick={() => ws.select('employee', m.id)} muted />
                ))}
                <ChainRow emp={emp} current />
              </div>
            </div>

            <div className="mt-3 border-t border-dashed border-line pt-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-medium text-muted">Direct reports · {reports.length}</span>
                <button onClick={() => orgNode && ws.addEmployee(orgNode, emp.id)} className="text-[12px] font-medium text-teal-600 hover:underline">
                  + Add
                </button>
              </div>
              {reports.length === 0 ? (
                <p className="text-sm text-muted">No direct reports.</p>
              ) : (
                <div className="relative">
                  {reports.length > 1 && <span className="absolute bottom-5 left-6 top-5 w-px bg-line" aria-hidden="true" />}
                  <div className="space-y-1">
                    {reports.map((r) => (
                      <ChainRow key={r.id} emp={r} onClick={() => ws.select('employee', r.id)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </motion.div>
  )
}

function Section({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-ink-800">
        {icon && <Icon name={icon} size={14} className="text-muted" />}{title}
      </h3>
      {children}
    </section>
  )
}

function DetailRow({ label, value, icon, children }: {
  label: string; value?: string; icon?: string; children?: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
        {icon && <Icon name={icon} size={12} className="shrink-0" />}
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink-900">
        <FitText>{children ?? value}</FitText>
      </dd>
    </div>
  )
}

function ChargeRow({ charge, onRemove }: { charge: Charge; onRemove: () => void }) {
  return (
    <div className={cn(
      'flex items-start gap-3 rounded-lg border px-3 py-2.5',
      charge.kind === 'acting' ? 'border-purple-600/40 bg-purple-100/40' : 'border-blue-600/40 bg-blue-100/40',
    )}>
      <Icon name={charge.kind === 'acting' ? 'Clock' : 'Briefcase'} size={15} className={cn('mt-0.5 shrink-0', charge.kind === 'acting' ? 'text-purple-600' : 'text-blue-600')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink-900">{charge.title}</span>
          <Badge tone={charge.kind === 'acting' ? 'purple' : 'blue'}>{charge.kind === 'acting' ? 'Acting' : 'Additional'}</Badge>
        </div>
        <div className="mt-0.5 text-[12px] text-muted">
          {charge.startDate ?? '—'}{charge.kind === 'acting' && ` → ${charge.endDate ?? 'ongoing'}`}
        </div>
        {charge.reason && <p className="mt-1 text-[12px] text-ink-700">{charge.reason}</p>}
      </div>
      <button onClick={onRemove} aria-label="Remove charge" className="rounded p-1 text-muted hover:bg-crimson-100 hover:text-crimson">
        <Icon name="X" size={14} />
      </button>
    </div>
  )
}

function TransferRow({ transfer }: { transfer: Transfer }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm text-ink-900">
        <span className="break-words">{transfer.fromOfficeName}</span>
        <Icon name="ArrowLeftRight" size={13} className="shrink-0 text-blue-600" />
        <span className="break-words font-medium">{transfer.toOfficeName}</span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[12px] text-muted">
        <span>Department: {transfer.fromDepartmentName} → {transfer.toDepartmentName}</span>
        <span>Effective: {transfer.effectiveDate}</span>
        {transfer.fromDesignation !== transfer.toDesignation && (
          <span>Designation: {transfer.fromDesignation} → {transfer.toDesignation}</span>
        )}
        {transfer.fromManagerName !== transfer.toManagerName && (
          <span className="flex flex-wrap items-center gap-1">
            Reports to: <ManagerName name={transfer.fromManagerName} /> → <ManagerName name={transfer.toManagerName} />
          </span>
        )}
        {transfer.reason && <span>Reason: {transfer.reason}</span>}
      </div>
      {transfer.remarks && <p className="mt-1 text-[12px] text-ink-700">{transfer.remarks}</p>}
    </div>
  )
}

/** Transfer manager names are snapshot strings (no record to pull a photo
 *  from), so the face is an initials avatar; blank snapshots stay as '—'. */
function ManagerName({ name }: { name: string | null | undefined }) {
  if (!name) return <span>—</span>
  return <PersonName person={{ name }} size="2xs" />
}

const ATTENDANCE_TYPES = new Set(['meeting', 'inPerson'])

/** Exported so Task 8.5's department-level Meetings section (DepartmentSection.tsx)
 *  can render the exact same entries/markup rather than duplicating this —
 *  `onSetAttended`/`onEdit` are omitted there, which hides both interactive
 *  controls for that read-only view. */
export function TimelineList({ events, onSetAttended, onEdit, highlightId, contactById }: {
  events: TimelineEvent[]
  onSetAttended?: (id: string, attended: boolean | undefined) => void
  onEdit?: (event: TimelineEvent) => void
  highlightId?: string | null
  /** Item 15: passed only by DepartmentSection, whose Meetings block
   *  aggregates entries across every contact under the department — unlike
   *  a single employee's own profile (where the contact is implicit), each
   *  row here needs to say WHICH contact it's about (item 11: with an
   *  avatar, like every other person-name surface). Omitted (the default)
   *  on the single-employee page, where showing it would be redundant. */
  contactById?: Map<string, Employee>
}) {
  const [pulsing, setPulsing] = useState(false)
  const highlightedRef = useRef<HTMLDivElement>(null)
  const { data: salesPersons = [] } = useSalesPersons()

  useEffect(() => {
    if (!highlightId) return
    highlightedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setPulsing(true)
    const timer = setTimeout(() => setPulsing(false), 2000)
    return () => clearTimeout(timer)
  }, [highlightId])

  if (events.length === 0) {
    return <p className="text-sm text-muted">Nothing logged yet. Add meetings, calls, or notes to build a history.</p>
  }
  return (
    <div className="relative">
      <span className="absolute bottom-2 left-[15px] top-2 w-px bg-line" aria-hidden="true" />
      <div className="space-y-3">
        {events.map((e) => {
          const meta = TIMELINE_META[e.type]
          const canMarkAttendance = !!onSetAttended && e.source === 'manual' && ATTENDANCE_TYPES.has(e.type)
          const canEdit = !!onEdit && e.source === 'manual'
          const isHighlighted = pulsing && e.id === highlightId
          return (
            <div
              key={e.id}
              ref={e.id === highlightId ? highlightedRef : undefined}
              className={cn('relative flex gap-3 rounded-lg transition-colors', isHighlighted && '-mx-2 bg-teal-100/40 px-2 py-1.5')}
            >
              <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-white">
                <Icon name={meta.icon} size={14} className="text-ink-700" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-ink-900">{e.title}</span>
                  {e.type !== 'joined' && <Badge tone={meta.tone}>{timelineEventLabel(e)}</Badge>}
                  {e.source === 'system' && <span className="text-[10px] uppercase tracking-wide text-muted">auto</span>}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => onEdit!(e)}
                      aria-label={`Edit ${e.title}`}
                      className="ml-auto shrink-0 rounded p-1 text-muted hover:bg-ink-900/[0.05] hover:text-ink-700"
                    >
                      <Icon name="Pencil" size={13} />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted">
                  <span>{e.date}{e.time && ` · ${e.time}`}</span>
                  {contactById?.get(e.employeeId) && (
                    <>
                      <span>·</span>
                      <Avatar person={contactById.get(e.employeeId)!} size="xs" />
                      <span className="font-medium text-ink-800">{contactById.get(e.employeeId)!.name}</span>
                    </>
                  )}
                </div>
                {e.note && <p className="mt-0.5 break-words text-[12px] text-ink-700">{e.note}</p>}
                {e.agenda && (
                  <p className="mt-0.5 break-words text-[12px] text-ink-700">
                    <span className="font-medium text-ink-900">Agenda: </span>{e.agenda}
                  </p>
                )}
                {e.outcome && (
                  <p className="mt-0.5 break-words text-[12px] text-ink-700">
                    <span className="font-medium text-ink-900">Outcome: </span>{e.outcome}
                  </p>
                )}
                {e.nextSteps && (
                  <p className="mt-0.5 break-words text-[12px] text-ink-700">
                    <span className="font-medium text-ink-900">Next steps: </span>{e.nextSteps}
                  </p>
                )}
                {e.attendees && e.attendees.length > 0 && (
                  <div className="mt-0.5 text-[12px] text-muted">
                    <span className="font-medium text-ink-900">Attendees</span>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {e.attendees.map((a, i) => {
                        const name = attendeeName(a)
                        const spId = attendeeSalesPersonId(a)
                        const person = spId ? salesPersons.find((p) => p.id === spId) : undefined
                        return (
                          <span key={`${name}-${i}`} className="flex items-center gap-1">
                            <Avatar person={{ name: person?.name ?? name, photoUrl: person?.photoUrl }} size="xs" />
                            {name}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
                {canMarkAttendance && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <AttendanceToggle
                      label="Attended"
                      active={e.attended === true}
                      activeTone="emerald"
                      onClick={() => onSetAttended!(e.id, e.attended === true ? undefined : true)}
                    />
                    <AttendanceToggle
                      label="Not attended"
                      active={e.attended === false}
                      activeTone="crimson"
                      onClick={() => onSetAttended!(e.id, e.attended === false ? undefined : false)}
                    />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AttendanceToggle({ label, active, activeTone, onClick }: {
  label: string
  active: boolean
  activeTone: 'emerald' | 'crimson'
  onClick: () => void
}) {
  const activeClass = activeTone === 'emerald'
    ? 'border-emerald-600 bg-emerald-100 text-emerald-700'
    : 'border-crimson bg-crimson-100 text-crimson'
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
        active ? activeClass : 'border-line text-muted hover:border-ink-600 hover:text-ink',
      )}
    >
      {label}
    </button>
  )
}

function ChainRow({ emp, onClick, current, muted }: {
  emp: Employee; onClick?: () => void; current?: boolean; muted?: boolean
}) {
  return (
    <div className="relative flex items-center">
      <button
        onClick={onClick}
        disabled={current}
        className={cn(
          'flex flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors',
          current ? 'bg-ink-900 text-paper' : 'hover:bg-ink-900/[0.05]',
        )}
      >
        <span className="relative z-10 shrink-0">
          <Avatar person={{ name: emp.name, photoUrl: emp.photoUrl, vacant: emp.vacant }} size="sm" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block break-words text-[13px] font-medium', current ? 'text-paper' : 'text-ink-900')}>
            {emp.vacant ? emp.designation || 'Vacant position' : emp.name}
          </span>
          <span className={cn('block break-words text-[11px]', current ? 'text-paper/70' : 'text-muted')}>{emp.designation}</span>
        </span>
      </button>
    </div>
  )
}
