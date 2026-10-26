import type { GridColumnMeta } from '../gridColumns'

/** The non-empty lines of a multi-line text cell: one bullet each. */
export const linesOf = (text: string): string[] => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

/** Long free text written as points, one per line: Next Action and the General long-text fields. */
export const isMultiline = (col: Pick<GridColumnMeta, 'multiline' | 'editable' | 'generalField'>): boolean =>
  !!col.multiline || (col.editable === 'general' && col.generalField?.kind === 'textarea')

/** Values listed one per line as bullets, wrapping within the column (multi-line text, multi-select). */
export function CellBullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4 text-left marker:text-muted">
      {items.map((item, i) => <li key={i} className="whitespace-pre-wrap [overflow-wrap:anywhere]">{item}</li>)}
    </ul>
  )
}
