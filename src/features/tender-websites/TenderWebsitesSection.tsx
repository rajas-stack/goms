import { useState } from 'react'
import type { TenderWebsite, TenderWebsiteKind } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Dialog } from '@/components/ui/Dialog'
import { LockSwitch } from '@/components/ui/LockSwitch'
import { TenderCredentialsDialog } from './TenderCredentialsDialog'
import { Can } from '@/lib/permissions'
import { useTenderDscEmployees, useTenderWebsiteMutations, useTenderWebsites } from './api'
import { TenderWebsiteForm } from './TenderWebsiteForm'
import { TenderWebsiteLink } from './TenderWebsiteLink'
import { WEBSITE_KIND_COPY } from './websiteKinds'

/** Settings body for one website page: the tender portals a bid's General tab
 *  offers as a dropdown, or the document verification portals. */
export function TenderWebsitesSection({ kind = 'tender' }: { kind?: TenderWebsiteKind }) {
  const copy = WEBSITE_KIND_COPY[kind]
  const { data: sites = [], isLoading, isError, error, refetch } = useTenderWebsites(kind)
  const { data: dscEmployees = [] } = useTenderDscEmployees()
  const { create, update, remove, editLock } = useTenderWebsiteMutations(kind)
  const [creating, setCreating] = useState(false)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [lockError, setLockError] = useState<string | null>(null)
  const viewing = sites.find(site => site.id === viewingId)

  const toggleEditing = async (site: TenderWebsite) => {
    setLockError(null)
    try { await editLock.mutateAsync({ id: site.id, locked: !site.editingLocked }) }
    catch (cause) { setLockError(cause instanceof Error ? cause.message : 'Could not change the editing lock.') }
  }

  const deleteSite = async (site: TenderWebsite) => {
    setDeleteError(null)
    try {
      await remove.mutateAsync(site.id)
      setConfirmingId(null)
    } catch (e) { setDeleteError(e instanceof Error ? e.message : `Could not delete ${site.name}.`) }
  }

  if (isLoading) return <div role="status" className="text-[13px] text-muted">Loading websites…</div>
  if (isError) {
    return (
      <div role="alert" className="flex items-center gap-2 text-[13px] text-crimson">
        {error instanceof Error ? error.message : 'Could not load websites.'}
        <Button size="sm" onClick={() => void refetch()}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Can module="bid.columns" action="create"><Button size="sm" variant="primary" onClick={() => { setEditingId(null); setCreating(true) }}><Icon name="Plus" size={14} /> Create new</Button></Can></div>
      {sites.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-3 text-[13px] text-muted">
          {copy.emptyText}
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white" aria-label={copy.listLabel}>
          {sites.map(site => (
            <li key={site.id} className="px-4 py-2.5">
              {editingId === site.id && !site.editingLocked ? (
                <TenderWebsiteForm existing={sites} editing={site} busy={update.isPending} submitLabel="Save" namePlaceholder={copy.namePlaceholder}
                  onSubmit={async input => { await update.mutateAsync({ id: site.id, ...input }); setEditingId(null) }}
                  onCancel={() => setEditingId(null)} />
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <TenderWebsiteLink site={site} className="text-[13px] font-semibold" />
                    <p className="truncate text-[12px] text-muted" title={site.url}>{site.url}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                      {site.credentials && <span className="inline-flex items-center gap-1"><Icon name="Lock" size={11} /> Credentials locked</span>}
                      {site.dscEmployeeId && <span>DSC: {dscEmployees.find(person => person.id === site.dscEmployeeId)?.name ?? 'Assigned employee (unavailable)'}</span>}
                    </div>
                  </div>
                  <Can module="bid.columns" action="update"><LockSwitch size="sm" unlocked={!site.editingLocked} onToggle={() => void toggleEditing(site)}
                    lockedLabel={`Unlock editing for ${site.name}`} unlockedLabel={`Lock editing for ${site.name}`} disabled={editLock.isPending} /></Can>
                  {site.credentials && <Button size="icon" variant="ghost" aria-label={`View credentials for ${site.name}`} onClick={() => setViewingId(site.id)}><Icon name="Eye" size={14} /></Button>}
                  {confirmingId === site.id ? (
                    <span className="flex items-center gap-1.5 text-[12px]">
                      <span className="text-ink-700">Delete {site.name}?</span>
                      <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => void deleteSite(site)}>Delete</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>Keep</Button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-0.5">
                      <Can module="bid.columns" action="update"><Button size="icon" variant="ghost" aria-label={`Edit ${site.name}`} disabled={!!site.editingLocked || editLock.isPending} onClick={() => { setConfirmingId(null); setEditingId(site.id) }}>
                        <Icon name="Pencil" size={14} />
                      </Button></Can>
                      <Can module="bid.columns" action="delete"><Button size="icon" variant="ghost" aria-label={`Delete ${site.name}`} onClick={() => { setEditingId(null); setConfirmingId(site.id) }}>
                        <Icon name="Trash2" size={14} />
                      </Button></Can>
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleteError && <p role="alert" className="text-[12px] text-crimson">{deleteError}</p>}
      {lockError && <p role="alert" className="text-[12px] text-crimson">{lockError}</p>}
      {creating && <Dialog open size="lg" title={copy.createTitle} onClose={() => { if (!create.isPending) setCreating(false) }}>
        <TenderWebsiteForm existing={sites} busy={create.isPending} submitLabel="Create" formLabel={copy.formLabel} namePlaceholder={copy.namePlaceholder} onSubmit={async input => { await create.mutateAsync(input); setCreating(false) }} onCancel={() => setCreating(false)} />
      </Dialog>}
      {viewing?.credentials && <TenderCredentialsDialog key={`${viewing.id}:${viewing.credentials.ciphertext}`} site={viewing} onClose={() => setViewingId(null)} />}
    </div>
  )
}
