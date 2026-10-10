import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'

/** Newline-separated storage preserves compatibility with existing meetings and drafts. */
export function RepeatableMeetingField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const rows = value.split(/\r?\n/)
  return <section aria-label={`Meeting ${label.toLowerCase()}`} className="space-y-2">
    <div className="flex items-center justify-between gap-2"><h3 className="text-[13px] font-medium text-ink-800">{label}</h3><Button size="sm" variant="ghost" disabled={disabled} aria-label={`Add ${label.toLowerCase()} row`} onClick={() => onChange([...rows, ''].join('\n'))}><Icon name="Plus" size={13} />Add row</Button></div>
    {rows.map((row, index) => <div key={index} className="flex items-center gap-2">
      <span className="w-4 shrink-0 text-xs text-muted" aria-hidden>{index + 1}</span>
      <Input aria-label={index === 0 ? label : `${label} row ${index + 1}`} value={row} disabled={disabled} placeholder={`Add ${label.toLowerCase()}…`} onChange={event => onChange(rows.map((item, i) => i === index ? event.target.value : item).join('\n'))} />
      {rows.length > 1 && <Button size="icon" variant="ghost" disabled={disabled} aria-label={`Remove ${label.toLowerCase()} row ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index).join('\n'))}><Icon name="X" size={13} /></Button>}
    </div>)}
  </section>
}
