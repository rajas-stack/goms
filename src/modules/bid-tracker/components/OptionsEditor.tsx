import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'

const box = 'h-8 min-w-0 flex-1 rounded-lg border border-line bg-white px-2 text-[13px] text-ink focus-visible:focus-ring'

/** Edits a select column's option list: add, remove, reorder. Blank and
 *  duplicate options are dropped by the domain's `normalizeOptions` on save. */
export function OptionsEditor({ value, onChange }: { value: string[]; onChange: (options: string[]) => void }) {
  const set = (i: number, v: string) => onChange(value.map((o, idx) => (idx === i ? v : o)))
  const move = (i: number, d: -1 | 1) => {
    const next = [...value]; const t = i + d
    if (t < 0 || t >= next.length) return
    ;[next[i], next[t]] = [next[t], next[i]]
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="Options">
      {value.map((option, i) => (
        <div key={i} className="flex items-center gap-1">
          <input aria-label={`Option ${i + 1}`} className={box} value={option} onChange={(e) => set(i, e.target.value)} />
          <Button variant="ghost" size="icon" aria-label={`Move option ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
            <Icon name="ArrowUp" size={14} />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Move option ${i + 1} down`} disabled={i === value.length - 1} onClick={() => move(i, 1)}>
            <Icon name="ArrowDown" size={14} />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Remove option ${i + 1}`} onClick={() => onChange(value.filter((_, idx) => idx !== i))}>
            <Icon name="X" size={14} />
          </Button>
        </div>
      ))}
      <div><Button variant="ghost" size="sm" onClick={() => onChange([...value, ''])}><Icon name="Plus" size={14} /> Add option</Button></div>
    </div>
  )
}
