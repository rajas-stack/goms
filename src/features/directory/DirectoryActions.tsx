import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { CommunicationContact, PolicyModuleKey } from '@goms/domain'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { Icon } from '@/components/ui/Icon'
import { LockSwitch } from '@/components/ui/LockSwitch'
import { Tooltip } from '@/components/ui/Tooltip'
import { useToast } from '@/components/ui/Toast'
import { TEAM_DEPARTMENT, type OrgPerson } from '@/data/org-structure'
import { useWorkspace } from '@/features/workspace/context'
import { TransferDialog } from '@/features/employees/TransferDialog'
import { SalesPersonFormDialog } from '@/features/sales/SalesPersonFormDialog'
import { TransferSalesPersonDialog } from '@/features/sales/TransferSalesPersonDialog'
import { useContactMutations } from '@/features/communication/api'
import { useEmployeeMutations, useOrgPersonMutations, useSalesPersonMutations } from '@/lib/api'
import { NO_PERMISSION_TITLE, isAllowed, usePermissions } from '@/lib/permissions'
import type { Employee, SalesPerson } from '@/lib/types'
import { cn } from '@/lib/utils'
import { entryKey, type DirectoryEntry, type DirectoryKind } from './directoryEntries'
import { ContactTransferDialog, OrgPersonTransferDialog } from './TransferDialogs'

export type DirectoryAction = 'edit' | 'delete' | 'transfer'

/** The source records behind the Directory's entries, so an action can open that record's own editor. */
export interface DirectoryRecords {
  employees: readonly Employee[]
  orgPeople: readonly OrgPerson[]
  salesPersons: readonly SalesPerson[]
  contacts: readonly CommunicationContact[]
}

interface DirectoryApi {
  /** Null when allowed, else why not (shown as the disabled icon's tooltip). */
  blocked: (entry: DirectoryEntry, action: DirectoryAction) => string | null
  run: (entry: DirectoryEntry, action: DirectoryAction) => void
  /** The entry whose profile is open in edit mode (`entryKey`), if any. */
  editingKey: string | null
  setEditingKey: (key: string | null) => void
  /** Edit, transfer and delete start locked on every visit, like the Opportunity master grid. */
  unlocked: boolean
  toggleLock: () => void
}

const Ctx = createContext<DirectoryApi | null>(null)
/** Null outside the Directory page (e.g. the State workspace), where these actions are not offered. */
export const useDirectoryActions = () => useContext(Ctx)

const MODULE: Record<DirectoryKind, PolicyModuleKey | null> = {
  employee: 'am.contacts', orgPerson: 'team.org', salesPerson: 'team.sales', contact: 'am.contacts', teamMember: null,
}
const ROSTER_ONLY = 'Added by hand to a team roster: change or remove them there'
const LOCKED = 'Locked: unlock the Directory to edit, transfer or delete'
const ACTION_LABEL: Record<DirectoryAction, string> = { edit: 'Edit', delete: 'Delete', transfer: 'Transfer' }
const ACTION_ICON: Record<DirectoryAction, string> = { edit: 'Pencil', delete: 'Trash2', transfer: 'ArrowLeftRight' }

type Pending = { action: Exclude<DirectoryAction, 'edit'> | 'editSales'; entry: DirectoryEntry } | null

export function DirectoryActionsProvider({ records, children }: { records: DirectoryRecords; children: ReactNode }) {
  const ws = useWorkspace()
  const perms = usePermissions()
  const [editingKey, setEditingKey] = useState<string | null>(null)
  // Edit asked for on another person: applied only once the selection really moves there, so an unsaved edit the
  // user chose to keep (UnsavedChangesGuard) is not swapped out from under them.
  const [requestedEdit, setRequestedEdit] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [unlocked, setUnlocked] = useState(false)
  // Edit mode belongs to the profile it was opened on.
  const selectedKey = ws.selection ? entryKey(ws.selection as { kind: DirectoryKind; id: string }) : null
  useEffect(() => {
    setEditingKey((key) => (key === selectedKey ? key : requestedEdit === selectedKey ? requestedEdit : null))
    setRequestedEdit(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  const blocked = (entry: DirectoryEntry, action: DirectoryAction): string | null => {
    if (!unlocked) return LOCKED
    const module = MODULE[entry.kind]
    if (!module) return action === 'edit' ? null : ROSTER_ONLY
    const ok = isAllowed(perms, module, action === 'delete' ? 'delete' : 'update')
      && !(entry.kind === 'employee' && action === 'transfer' && !isAllowed(perms, 'am.departments', 'update')) // re-posting touches both
    return ok ? null : NO_PERMISSION_TITLE
  }

  const run = (entry: DirectoryEntry, action: DirectoryAction) => {
    if (blocked(entry, action)) return
    if (action !== 'edit') { setPending({ action, entry }); return }
    ws.select(entry.kind, entry.id)
    const employee = entry.kind === 'employee' ? records.employees.find((e) => e.id === entry.id) : undefined
    if (employee) ws.editEmployee(employee)
    else if (entry.kind === 'salesPerson') setPending({ action: 'editSales', entry })
    else if (entry.kind === 'orgPerson' || entry.kind === 'contact') {
      const key = entryKey(entry)
      if (key === selectedKey) setEditingKey(key); else if (!editingKey) setRequestedEdit(key) // with an edit open, just move (after the discard prompt)
    }
  }

  return (
    <Ctx.Provider value={{ blocked, run, editingKey, setEditingKey, unlocked, toggleLock: () => setUnlocked((v) => !v) }}>
      {children}
      {pending && <PendingDialog pending={pending} records={records} onClose={() => setPending(null)} />}
    </Ctx.Provider>
  )
}

function PendingDialog({ pending: { action, entry }, records, onClose }: { pending: NonNullable<Pending>; records: DirectoryRecords; onClose: () => void }) {
  const employee = entry.kind === 'employee' ? records.employees.find((e) => e.id === entry.id) ?? null : null
  const orgPerson = entry.kind === 'orgPerson' ? records.orgPeople.find((p) => p.id === entry.id) : undefined
  const salesPerson = entry.kind === 'salesPerson' ? records.salesPersons.find((p) => p.id === entry.id) ?? null : null
  const contact = entry.kind === 'contact' ? records.contacts.find((c) => c.id === entry.id) : undefined
  if (action === 'editSales') return <SalesPersonFormDialog open personId={entry.id} onClose={onClose} />
  if (action === 'delete') return <DeleteDialog entry={entry} records={records} onClose={onClose} />
  if (employee) return <TransferDialog open employee={employee} onClose={onClose} />
  if (salesPerson) return <TransferSalesPersonDialog open person={salesPerson} onClose={onClose} />
  if (orgPerson) return <OrgPersonTransferDialog person={orgPerson} onClose={onClose} />
  if (contact) return <ContactTransferDialog contact={contact} onClose={onClose} />
  return null
}

/** Each kind keeps its existing delete rule; the dialog names what else the delete touches before anything happens. */
function DeleteDialog({ entry, records, onClose }: { entry: DirectoryEntry; records: DirectoryRecords; onClose: () => void }) {
  const ws = useWorkspace()
  const toast = useToast()
  const employeeMutations = useEmployeeMutations()
  const orgMutations = useOrgPersonMutations()
  const salesMutations = useSalesPersonMutations()
  const contactMutations = useContactMutations()

  const remove = (): Promise<unknown> => {
    switch (entry.kind) {
      case 'employee': return employeeMutations.remove.mutateAsync(entry.id)
      case 'orgPerson': return orgMutations.remove.mutateAsync(entry.id)
      case 'salesPerson': return salesMutations.remove.mutateAsync(entry.id)
      case 'contact': return contactMutations.remove.mutateAsync(entry.id)
      default: return Promise.reject(new Error(ROSTER_ONLY))
    }
  }
  return (
    <ConfirmDeleteDialog
      open onClose={onClose} itemLabel={entry.name}
      onConfirm={async () => {
        await remove()
        toast(`Deleted ${entry.name}`)
        if (ws.selection?.kind === entry.kind && ws.selection.id === entry.id) ws.clearSelection()
      }}
    >
      <ul className="mt-3 list-disc space-y-1 pl-5 text-[12px] text-ink-700" aria-label="Linked records">
        {linkedRecords(entry, records).map((line) => <li key={line}>{line}</li>)}
      </ul>
    </ConfirmDeleteDialog>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function linkedRecords(entry: DirectoryEntry, records: DirectoryRecords): string[] {
  if (entry.kind === 'employee') {
    const person = records.employees.find((e) => e.id === entry.id)
    const reports = records.employees.filter((e) => e.managerId === entry.id).length
    const boss = records.employees.find((e) => e.id === person?.managerId)?.name ?? 'no manager'
    const charges = person?.charges.length ?? 0
    // Mirrors employees.delete on the server.
    return [
      reports ? `${plural(reports, 'person who reports', 'people who report')} to them move${reports === 1 ? 's' : ''} up to ${boss}.` : 'No one reports to them.',
      'If they head a department, that department is left without a head.',
      'Their follow-ups are deleted.',
      ...(charges ? [`Their ${plural(charges, 'charge')} go with them.`] : []),
      'Meetings and opportunities that mention them keep their own records.',
    ]
  }
  if (entry.kind === 'orgPerson') {
    const person = records.orgPeople.find((p) => p.id === entry.id)
    const reports = records.orgPeople.filter((p) => p.managerId === entry.id).length
    const boss = records.orgPeople.find((p) => p.id === person?.managerId)?.name ?? 'the top of the company'
    const teams = Object.values(TEAM_DEPARTMENT).filter((d) => person?.departments.includes(d))
    return [
      reports ? `${plural(reports, 'direct report')} ${reports === 1 ? 'moves' : 'move'} up to ${boss}.` : 'No one reports to them.',
      ...(teams.length ? [`Their ${teams.join(', ')} roster entries turn inactive; opportunity assignments are kept.`] : []),
    ]
  }
  if (entry.kind === 'salesPerson') return ['Their postings and ownership history stay on record.']
  if (entry.kind === 'contact') return ['Only the address-book entry goes: mail threads already linked to opportunities keep their participants and category.']
  return []
}

/** Pencil / bin / transfer icons for one entry. Each opens that record's own editor or dialog; disabled with the reason
 *  when the role (or the record) does not allow it. */
export function EntryActions({ entry, selected = false, className }: { entry: DirectoryEntry; selected?: boolean; className?: string }) {
  const api = useDirectoryActions()
  if (!api) return null
  return (
    <span className={cn('flex items-center gap-0.5', className)}>
      {(['edit', 'transfer', 'delete'] as const).map((action) => {
        const reason = api.blocked(entry, action)
        const label = `${ACTION_LABEL[action]} ${entry.name}`
        return (
          <Tooltip key={action} label={reason ?? ACTION_LABEL[action]} side="top">
            <button
              type="button" aria-label={label} disabled={!!reason}
              onClick={(event) => { event.stopPropagation(); api.run(entry, action) }}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-35',
                selected ? 'text-paper/70 hover:bg-paper/15 hover:text-paper' : 'text-muted hover:bg-ink-900/[0.06] hover:text-ink-900',
                action === 'delete' && !selected && 'hover:text-crimson',
              )}
            >
              <Icon name={ACTION_ICON[action]} size={14} />
            </button>
          </Tooltip>
        )
      })}
    </span>
  )
}

/** The Directory's edit lock, with the same switch and labels pattern as the Opportunity master grid. */
export function DirectoryLockSwitch({ className }: { className?: string }) {
  const api = useDirectoryActions()
  if (!api) return null
  return (
    <LockSwitch
      unlocked={api.unlocked} onToggle={api.toggleLock} className={className}
      lockedLabel="Directory editing locked — tap to unlock"
      unlockedLabel="Directory editing unlocked — tap to lock"
    />
  )
}
