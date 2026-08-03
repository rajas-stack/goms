import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { useToast } from '@/components/ui/Toast'
import { useMasters, useMasterMutations } from '../api'
import { MASTER_DEFS } from '../master-defs'
import { MasterFormDialog } from './MasterFormDialog'
import { EditionFeatureMappingDialog } from './EditionFeatureMappingDialog'
import type { MasterBase, MasterEntityKey } from '../types'

type MasterRow = MasterBase & Record<string, unknown>

/** One generic list/search/CRUD screen serving all 12 master tables — spec
 *  §4.3/§4.4. `masterKey` selects which table; `MASTER_DEFS[masterKey]`
 *  supplies the extra fields the create/edit form needs beyond the
 *  code/name/description/active every master already has. */
export function MasterCrudScreen({ masterKey }: { masterKey: MasterEntityKey }) {
  const def = MASTER_DEFS[masterKey]
  const { data: rows = [], isLoading } = useMasters(masterKey)
  const { create, update, setActive, remove } = useMasterMutations(masterKey)
  const toast = useToast()

  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<MasterRow | null>(null)
  const [deleting, setDeleting] = useState<MasterRow | null>(null)
  const [managingFeaturesFor, setManagingFeaturesFor] = useState<MasterRow | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? rows.filter((r) => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      : rows
    return [...list].sort((a, b) => a.displayOrder - b.displayOrder)
  }, [rows, query])

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }
  function openEdit(row: MasterRow) {
    setEditing(row)
    setFormOpen(true)
  }

  async function handleSubmit(values: Record<string, string | number | boolean>, changeReason?: string) {
    if (editing) {
      await update.mutateAsync({ id: editing.id, patch: values as never, changeReason })
      toast(`${def.singularLabel} updated.`)
    } else {
      await create.mutateAsync(values as never)
      toast(`${def.singularLabel} created.`)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Icon name="Search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${def.label.toLowerCase()}…`}
            className="pl-9"
          />
        </div>
        <Button variant="primary" size="sm" onClick={openCreate}>
          <Icon name="Plus" size={15} />
          Add {def.singularLabel}
        </Button>
      </div>

      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <Icon name="Boxes" size={20} className="text-muted" />
          <p className="text-sm text-muted">No {def.label.toLowerCase()} yet.</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map((row) => (
          <div key={row.id} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded bg-panel px-1.5 py-0.5 text-[11px] font-mono text-ink-700">{row.code}</span>
                <span className="truncate text-sm font-medium text-ink-900">{row.name}</span>
                {!row.active && (
                  <span className="shrink-0 rounded-full bg-ink-900/[0.06] px-2 py-0.5 text-[11px] font-medium text-ink-600">
                    Inactive
                  </span>
                )}
              </div>
              {Boolean(row.description) && <div className="truncate text-[12px] text-muted">{String(row.description)}</div>}
            </div>
            {masterKey === 'productEditions' && (
              <Button size="sm" onClick={() => setManagingFeaturesFor(row as unknown as MasterRow)}>Features</Button>
            )}
            <Button
              size="icon"
              onClick={() => setActive.mutate({ id: row.id, active: !row.active })}
              title={row.active ? 'Deactivate' : 'Activate'}
            >
              <Icon name={row.active ? 'ArchiveRestore' : 'Archive'} size={15} />
            </Button>
            <Button size="icon" onClick={() => openEdit(row as unknown as MasterRow)} title="Edit">
              <Icon name="Pencil" size={15} />
            </Button>
            <Button size="icon" onClick={() => setDeleting(row as unknown as MasterRow)} title="Delete">
              <Icon name="Trash2" size={15} />
            </Button>
          </div>
        ))}
      </div>

      <MasterFormDialog
        masterKey={masterKey}
        def={def}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        onSubmit={handleSubmit}
      />
      {deleting && (
        <ConfirmDeleteDialog
          open={!!deleting}
          onClose={() => setDeleting(null)}
          itemLabel={deleting.name}
          onConfirm={() => remove.mutateAsync(deleting.id)}
        />
      )}
      {managingFeaturesFor && (
        <EditionFeatureMappingDialog
          open={!!managingFeaturesFor}
          onClose={() => setManagingFeaturesFor(null)}
          edition={managingFeaturesFor}
        />
      )}
    </div>
  )
}
