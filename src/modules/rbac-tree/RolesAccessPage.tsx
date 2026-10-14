import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import type { RbacSubjectRef } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { useIsSystemAdmin } from '@/modules/admin-access/useIsSystemAdmin'
import { errorText, useRbacMutations, useRbacNodes, useRbacSubjects } from './api'
import { NameDialog, RoleDialog } from './dialogs'
import { SubjectEditor } from './SubjectEditor'
import { SubjectPicker } from './SubjectPicker'
import { useMasterEmployees } from '@/features/org/useMasterEmployees'
import '@/components/theme/SettingsMenu.css'

const LOCAL_MODE = !import.meta.env.VITE_API_BASE_URL

/**
 * Settings > System settings > Roles & Access: the permission tree editor (docs/superpowers/specs/2026-10-14-dynamic-rbac-design.md).
 * Everyone who can read Role & Access may look; only System Admins may change anything (the server enforces it: every write
 * is `systemAdminProcedure`). The tree only narrows what each role's server permissions already allow.
 */
export function RolesAccessPage() {
  const nodes = useRbacNodes()
  const subjects = useRbacSubjects()
  const { employees } = useMasterEmployees()
  // RBAC off reports no roles; the subjects read is System-Admin-gated in that mode, so its success identifies one.
  const isSystemAdmin = useIsSystemAdmin(subjects.isSuccess)
  const canEdit = LOCAL_MODE || isSystemAdmin
  const m = useRbacMutations()
  const toast = useToast()
  const [selected, setSelected] = useState<RbacSubjectRef | null>({ type: 'role', id: 'sales' })
  const [dirty, setDirty] = useState(false)
  const [dialog, setDialog] = useState<null | 'role' | 'template'>(null)
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), [])

  const select = (next: RbacSubjectRef | null) => {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    setDirty(false)
    setSelected(next)
  }
  const sync = async () => {
    try {
      const r = await m.sync.mutateAsync()
      toast(`Synced: ${r.added} new, ${r.updated} updated, ${r.retired} retired, ${r.restored} restored.`)
    } catch (e) { toast(errorText(e, 'Could not sync.'), undefined, 'error') }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <Link to="/settings" className="settings-back focus-visible:focus-ring"><Icon name="ArrowLeft" size={15} />Settings</Link>
          <h1 className="mt-1 font-display text-xl font-semibold text-ink-900">Roles &amp; Access</h1>
          <p className="mt-0.5 max-w-2xl text-[13px] text-muted">
            Choose what each role, person or template can see and do, area by area. Settings flow down the tree; a child can override its parent.
            This only narrows what a role&apos;s server permissions already allow.
          </p>
        </div>
        {canEdit && (
          <Button size="sm" variant="secondary" disabled={m.sync.isPending} onClick={() => void sync()} title="Pick up new pages, tabs and sections from the latest release">
            <Icon name="RotateCcw" size={14} /> Sync now
          </Button>
        )}
      </header>
      {!canEdit && (
        <p role="note" className="flex items-center gap-2 border-b border-line bg-panel px-4 py-2 text-[13px] text-muted sm:px-6">
          <Icon name="Lock" size={14} /> Read-only: only System Admins can change roles and access.
        </p>
      )}
      {nodes.isError || subjects.isError
        ? <p role="alert" className="p-6 text-[13px] text-crimson">{errorText(nodes.error ?? subjects.error, 'Could not load Roles & Access.')}</p>
        : (
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <SubjectPicker subjects={subjects.data} employees={employees} selected={selected} canEdit={canEdit} onSelect={select}
              onNewRole={() => setDialog('role')} onNewTemplate={() => setDialog('template')} />
            {selected && nodes.data
              ? <SubjectEditor key={`${selected.type}:${selected.id}`} subject={selected} subjects={subjects.data} nodes={nodes.data} canEdit={canEdit}
                  onDirtyChange={onDirtyChange} onSelect={select} />
              : <div className="flex flex-1 items-center justify-center p-8 text-[13px] text-muted">{nodes.isLoading ? 'Loading…' : 'Pick a role, person or template.'}</div>}
          </div>
        )}
      <RoleDialog open={dialog === 'role'} role={null} onClose={() => setDialog(null)}
        onSubmit={async (input) => select({ type: 'role', id: (await m.createRole.mutateAsync(input)).id })} />
      <NameDialog open={dialog === 'template'} title="New template" confirm="Create template" onClose={() => setDialog(null)}
        onSubmit={async (name, description) => select({ type: 'template', id: (await m.createTemplate.mutateAsync({ name, description })).id })} />
    </div>
  )
}
