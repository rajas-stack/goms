import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { useAllEmployees, useSalesPersons } from '@/lib/api'
import { FrozenSelection, WorkspaceProvider, useWorkspace } from '@/features/workspace/context'
import { PeopleDirectory, type TypeFilter } from '@/features/directory/PeopleDirectory'
import { DetailsPanel } from '@/features/details/DetailsPanel'
import { DirectoryActionsProvider, DirectoryLockSwitch, EntryActions } from '@/features/directory/DirectoryActions'
import { NewContactDialog } from '@/features/directory/NewContactDialog'
import {
  externalCategories, fromContact, fromMasterEmployee, internalCategories, readTypeFilter, type ContactType,
} from '@/features/directory/directoryEntries'
import { useMasterEmployees } from '@/features/org/useMasterEmployees'
import { useAmnexDepartments } from '@/features/departments/api'
import { useCommunicationContacts } from '@/features/communication/api'
import { useDirectoryTypes } from '@/features/masters/useMasterOptions'
import { IconButton } from '@/components/ui/IconButton'
import { useAllowed, useCanReadAny } from '@/lib/permissions'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { MobileDetailsSheet } from './StateWorkspace'

/** The one Directory of people (sidebar › Directory): Amnex employees and external contacts, each still stored in its own
 *  master. Reuses the workspace context, details panel and phonebook list the state workspace's People tab uses. */
export function Directory({ actionsSlot }: {
  /** Where the lock and New contact button go (the Teams tab row); without one they sit above the list. */
  actionsSlot?: HTMLElement | null
}) {
  return (
    <WorkspaceProvider stateCode={-1}>
      <DirectoryPage actionsSlot={actionsSlot} />
    </WorkspaceProvider>
  )
}

function DirectoryPage({ actionsSlot }: { actionsSlot?: HTMLElement | null }) {
  const canInternal = useCanReadAny(['team.org', 'team.sales'])
  const canExternal = useCanReadAny(['am.contacts'])
  const { data: amPeople = [] } = useAllEmployees()
  const { employees: internal, orgPeople } = useMasterEmployees()
  const { data: salesPersons = [] } = useSalesPersons()
  const { data: contacts = [] } = useCommunicationContacts()
  const { data: departments = [] } = useAmnexDepartments()
  const directoryTypes = useDirectoryTypes()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [creating, setCreating] = useState(false)
  const canCreateInternal = useAllowed('team.org', 'create')
  const canCreateExternal = useAllowed('am.contacts', 'create')

  // The lock guards edit / transfer / delete only; adding a contact stays a separate permission.
  const actions = (
    <div className="flex items-center gap-2">
      <DirectoryLockSwitch />
      {(canCreateInternal || canCreateExternal) && <IconButton icon="UserPlus" label="New contact" variant="primary" side="left" onClick={() => setCreating(true)} />}
    </div>
  )

  const employees = canExternal ? amPeople : []
  const others = useMemo(() => {
    const photoOf = new Map(orgPeople.map((p) => [p.id, p.photoUrl ?? null]))
    return [
      ...(canInternal ? internal.map((e) => fromMasterEmployee(e, e.orgPersonId ? photoOf.get(e.orgPersonId) : null)) : []),
      ...(canExternal ? contacts.map(fromContact) : []),
    ]
  }, [internal, orgPeople, contacts, canInternal, canExternal])

  // `?type=` / `?cat=` keep a filtered Directory linkable; the selection params beside them are left alone.
  const [params, setParams] = useSearchParams()
  const { type, category } = readTypeFilter(params.get('type'), params.get('cat'))
  const internalOptions = useMemo(() => internalCategories(departments.map((d) => d.name), others), [departments, others])
  const externalOptions = useMemo(() => externalCategories(directoryTypes), [directoryTypes])
  const typeFilter: TypeFilter = {
    type, category, internalOptions, externalOptions,
    onChange: (nextType: ContactType | '', nextCategory: string) => setParams((p) => {
      if (nextType) p.set('type', nextType); else p.delete('type')
      if (nextType && nextCategory) p.set('cat', nextCategory); else p.delete('cat')
      return p
    }, { replace: true }),
  }

  return (
    <DirectoryActionsProvider records={{ employees: amPeople, orgPeople, salesPersons, contacts }}>
      <div className="flex h-full flex-col lg:flex-row">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-b border-line lg:border-b-0 lg:border-r">
          {actionsSlot ? createPortal(actions, actionsSlot) : <div className="flex justify-end px-4 pt-2">{actions}</div>}
          <div className="relative min-h-0 flex-1">
            <PeopleDirectory
              employees={employees} others={others} typeFilter={typeFilter}
              renderActions={(entry, selected) => <EntryActions entry={entry} selected={selected} />}
            />
          </div>
        </div>

        {isDesktop ? <ProfileAside /> : <MobileDetailsSheet />}
      </div>
      {creating && (
        <NewContactDialog
          initialCategory={type === 'internal' ? 'internal' : category} internalOptions={internalOptions} externalOptions={externalOptions}
          internalLabel={directoryTypes.find((d) => d.code === 'internal')?.name ?? 'Amnex Employee'}
          canInternal={canCreateInternal} canExternal={canCreateExternal} onClose={() => setCreating(false)}
        />
      )}
    </DirectoryActionsProvider>
  )
}

/** The docked profile. Its open/close state lives here, so flipping it re-renders only this shell — not the
 *  Directory list — in the frame the slide starts. Opening and closing share one motion: the list narrows as
 *  the panel widens, fades and slides in (and back). One panel instance whether docked or full screen (only
 *  classes change), so an open edit survives the switch. */
function ProfileAside() {
  const ws = useWorkspace()
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { if (!ws.selection) setExpanded(false) }, [ws.selection])
  // The last contact shown, kept while the panel animates closed so it doesn't flash to an empty state.
  const [shown, setShown] = useState(ws.selection)
  useEffect(() => { if (ws.selection) setShown(ws.selection) }, [ws.selection])
  // Opening waits two frames: the profile renders while still collapsed, so its render cost can't eat the
  // first frames of the slide. Closing starts at once.
  const [open, setOpen] = useState(!!ws.selection)
  useEffect(() => {
    if (!ws.selection) { setOpen(false); return }
    let second = 0
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setOpen(true)) })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [ws.selection])
  const hasSelection = !!ws.selection
  // Same element across the open flip, so React skips re-rendering the profile when only the shell's classes change.
  const panel = useMemo(() => shown && (
    <FrozenSelection selection={ws.selection ?? shown}>
      <DetailsPanel floatingClose expanded={expanded} onToggleExpand={hasSelection ? () => setExpanded((v) => !v) : undefined} />
    </FrozenSelection>
  ), [shown, ws.selection, expanded, hasSelection])

  return (
    <aside
      aria-label="Profile" aria-hidden={!open} inert={!open}
      className={cn(
        'min-h-0 shrink-0 overflow-hidden bg-paper motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)]',
        expanded ? 'fixed inset-0 z-40' : open ? 'w-[400px]' : 'w-0',
      )}
    >
      <div className={cn(
        'h-full overflow-y-auto scrollbar-thin motion-safe:transition-[opacity,transform] motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)]',
        expanded ? 'mx-auto max-w-4xl border-x border-line' : 'w-[400px]',
        open ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0',
      )}>
        {panel}
      </div>
    </aside>
  )
}
