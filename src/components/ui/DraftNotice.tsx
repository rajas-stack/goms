import { Icon } from './Icon'

/** Shown at the top of a form whose input was restored from a saved draft, so
 *  the user knows why fields are pre-filled with something the record doesn't
 *  contain — and can get back to the record's own values in one tap. */
export function DraftNotice({ onDiscard }: { onDiscard: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber/40 bg-amber-100/60 px-3 py-2">
      <Icon name="RotateCcw" size={14} className="shrink-0 text-amber-600" />
      <p className="min-w-0 flex-1 text-[12px] text-ink-800">Restored your unsaved changes.</p>
      <button
        type="button"
        onClick={onDiscard}
        className="shrink-0 rounded px-1.5 py-1 text-[12px] font-medium text-ink-700 underline decoration-ink-700/40 underline-offset-2 hover:text-ink-900"
      >
        Discard
      </button>
    </div>
  )
}
