import { Link } from 'react-router-dom'
import type { MakerDocument } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { Menu, MenuDivider, MenuItem } from '@/components/ui/Menu'
import { PersonName } from '@/components/ui/PersonName'
import { cn } from '@/lib/utils'
import { editedLabel, formatBytes, KIND_META } from './kinds'
import { useOwnerPerson } from './useOwner'

export type FileAction = 'rename' | 'duplicate' | 'download' | 'delete'

/** The user's files: a table on wide screens, stacked rows on a phone (same markup, grid columns collapse). */
/** `can` hides menu actions the permission tree does not allow (default: all allowed). */
export function FileList({ files, onAction, can = () => true }: {
  files: MakerDocument[]; onAction: (action: FileAction, doc: MakerDocument) => void; can?: (action: FileAction) => boolean
}) {
  const ownerOf = useOwnerPerson()
  return (
    <div role="table" aria-label="Your files" className="overflow-hidden rounded-2xl border border-line bg-white">
      <div role="rowgroup">
        <div role="row" className="hidden grid-cols-[minmax(0,1fr)_9rem_12rem_3rem] items-center gap-4 border-b border-line bg-panel/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted md:grid">
          <span role="columnheader">Name</span>
          <span role="columnheader">Last edited</span>
          <span role="columnheader">Owner</span>
          <span role="columnheader"><span className="sr-only">Actions</span></span>
        </div>
      </div>
      <div role="rowgroup">
        {files.map((doc) => {
          const meta = KIND_META[doc.kind]
          return (
            <div
              key={doc.id}
              role="row"
              className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-b-0 hover:bg-grid-hover md:grid-cols-[minmax(0,1fr)_9rem_12rem_3rem]"
            >
              <div role="cell" className="flex min-w-0 items-center gap-3">
                <span aria-hidden className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', meta.tint, meta.text)}>
                  <Icon name={meta.icon} size={17} />
                </span>
                <span className="min-w-0">
                  <Link
                    to={`/document-maker/${doc.id}`}
                    className="block truncate text-[14px] font-medium text-ink-900 hover:underline focus-visible:focus-ring"
                  >
                    {doc.title}
                  </Link>
                  <span className="block truncate text-[12px] text-muted">
                    {meta.label} · .{doc.fileType} · {formatBytes(doc.size)}
                    <span className="md:hidden"> · {editedLabel(doc.updatedAt)}</span>
                  </span>
                </span>
              </div>
              <span role="cell" className="hidden text-[13px] tabular-nums text-ink md:block" title={new Date(doc.updatedAt).toLocaleString('en-IN')}>
                {editedLabel(doc.updatedAt)}
              </span>
              <span role="cell" className="hidden min-w-0 text-[13px] text-ink md:block">
                <PersonName person={ownerOf(doc)} />
              </span>
              <span role="cell" className="justify-self-end">
                <Menu trigger={({ toggle, open }) => (
                  <button
                    type="button"
                    onClick={toggle}
                    aria-label={`Actions for ${doc.title}`}
                    aria-expanded={open}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-ink-900/[0.06] hover:text-ink focus-visible:focus-ring"
                  >
                    <Icon name="MoreHorizontal" size={17} />
                  </button>
                )}>
                  {(close) => (
                    <>
                      {can('rename') && <MenuItem icon={<Icon name="Pencil" size={15} />} onClick={() => { close(); onAction('rename', doc) }}>Rename</MenuItem>}
                      {can('duplicate') && <MenuItem icon={<Icon name="Copy" size={15} />} onClick={() => { close(); onAction('duplicate', doc) }}>Duplicate</MenuItem>}
                      {can('download') && <MenuItem icon={<Icon name="Download" size={15} />} onClick={() => { close(); onAction('download', doc) }}>Download .{doc.fileType}</MenuItem>}
                      {can('delete') && <MenuDivider />}
                      {can('delete') && <MenuItem danger icon={<Icon name="Trash2" size={15} />} onClick={() => { close(); onAction('delete', doc) }}>Delete</MenuItem>}
                    </>
                  )}
                </Menu>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
