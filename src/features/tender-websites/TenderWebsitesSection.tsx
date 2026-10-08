import { useState } from 'react'
import type { TenderWebsite } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useTenderDscEmployees, useTenderWebsiteMutations, useTenderWebsites } from './api'
import { TenderWebsiteForm } from './TenderWebsiteForm'
import { TenderWebsiteLink } from './TenderWebsiteLink'

/** Settings body: the tender portals a bid's General tab offers as a dropdown. */
export function TenderWebsitesSection() {
  const { data: sites = [], isLoading, isError, error, refetch } = useTenderWebsites()
  const { data: dscEmployees = [] } = useTenderDscEmployees()
  const { create, update, remove } = useTenderWebsiteMutations()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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
      {sites.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-3 text-[13px] text-muted">
          No websites yet. Add the portals you download tender documents from, such as E-Proc or GeM.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white" aria-label="Saved tender websites">
          {sites.map(site => (
            <li key={site.id} className="px-4 py-2.5">
              {editingId === site.id ? (
                <TenderWebsiteForm existing={sites} editing={site} busy={update.isPending} submitLabel="Save"
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
                  {confirmingId === site.id ? (
                    <span className="flex items-center gap-1.5 text-[12px]">
                      <span className="text-ink-700">Delete {site.name}?</span>
                      <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => void deleteSite(site)}>Delete</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>Keep</Button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-0.5">
                      <Button size="icon" variant="ghost" aria-label={`Edit ${site.name}`} onClick={() => { setConfirmingId(null); setEditingId(site.id) }}>
                        <Icon name="Pencil" size={14} />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete ${site.name}`} onClick={() => { setEditingId(null); setConfirmingId(site.id) }}>
                        <Icon name="Trash2" size={14} />
                      </Button>
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleteError && <p role="alert" className="text-[12px] text-crimson">{deleteError}</p>}
      <TenderWebsiteForm existing={sites} busy={create.isPending} submitLabel="Add" onSubmit={input => create.mutateAsync(input)} />
    </div>
  )
}
