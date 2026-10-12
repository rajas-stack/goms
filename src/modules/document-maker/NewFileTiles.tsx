import type { MakerDocumentKind } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { KIND_META, MAKER_KIND_ORDER } from './kinds'

/** "Start a new file" strip: one raised tile per Office type, plus Upload. */
export function NewFileTiles({ onCreate, onUpload, busy }: {
  onCreate: (kind: MakerDocumentKind) => void
  onUpload: () => void
  busy: boolean
}) {
  return (
    <section aria-labelledby="dm-new-heading" className="space-y-3">
      <h2 id="dm-new-heading" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Start a new file</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {MAKER_KIND_ORDER.map((kind) => {
          const meta = KIND_META[kind]
          return (
            <button
              key={kind}
              type="button"
              disabled={busy}
              onClick={() => onCreate(kind)}
              aria-label={`New ${meta.label.toLowerCase()}`}
              className="neu-raised group relative flex min-h-[112px] flex-col justify-between overflow-hidden rounded-2xl p-4 text-left transition-transform duration-150 hover:-translate-y-0.5 focus-visible:focus-ring active:translate-y-0 disabled:opacity-50"
            >
              <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', meta.tint, meta.text)}>
                <Icon name={meta.icon} size={20} />
              </span>
              <span>
                <span className="flex items-center gap-1.5 text-[14px] font-semibold text-ink-900">
                  {meta.label}
                  <Icon name="Plus" size={13} className="text-muted transition-colors group-hover:text-ink-900" />
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-muted">{meta.hint}</span>
              </span>
              <span aria-hidden className={cn('pointer-events-none absolute right-3 top-3 font-mono text-[10px] font-semibold tracking-wider', meta.text)}>{meta.ext}</span>
            </button>
          )
        })}
        <button
          type="button"
          disabled={busy}
          onClick={onUpload}
          className="neu-inset flex min-h-[112px] flex-col items-start justify-between rounded-2xl border border-dashed border-line p-4 text-left transition-colors hover:border-ink-600 focus-visible:focus-ring disabled:opacity-50"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink-900/[0.06] text-ink-700">
            <Icon name="FileUp" size={20} />
          </span>
          <span>
            <span className="block text-[14px] font-semibold text-ink-900">Upload</span>
            <span className="mt-0.5 block text-[12px] leading-snug text-muted">.docx, .xlsx or .pptx up to 5 MB</span>
          </span>
        </button>
      </div>
    </section>
  )
}
