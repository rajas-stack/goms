import {
  CORRIGENDUM_AFFECTED_MODULES, CORRIGENDUM_IMPACT_LABELS, CORRIGENDUM_IMPACT_LEVELS, CORRIGENDUM_MODULE_LABELS,
  CORRIGENDUM_REVIEW_STATUSES, CORRIGENDUM_REVIEW_STATUS_LABELS, type CorrigendumImpactLevel, type CorrigendumReviewStatus,
} from '@goms/domain'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { FriendlyDateInput } from '@/components/ui/FriendlyDateInput'
import { PersonName } from '@/components/ui/PersonName'
import { useDeliveryTeamMembers } from '@/lib/api'
import type { CorrigendumRegister } from '@/lib/types'
import { cn } from '@/lib/utils'

const FLAGS = [
  ['technicalImpact', 'Technical Impact'], ['commercialImpact', 'Commercial Impact'],
  ['bidDateImpact', 'Bid Date Impact'], ['submissionDateImpact', 'Submission Date Impact'],
] as const
const DATES = [['publishedDate', 'Published Date'], ['receivedDate', 'Received Date'], ['effectiveDate', 'Effective Date']] as const

function YesNo({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2">
      <span className="text-[13px] text-ink-800">{label}</span>
      <span className="flex rounded-md bg-panel p-0.5">
        {[true, false].map((v) => (
          <button
            key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
            className={cn('rounded px-2.5 py-0.5 text-[12px] font-semibold focus-visible:focus-ring',
              value === v ? (v ? 'bg-amber-100 text-amber-700 shadow-sm' : 'bg-white text-ink-800 shadow-sm') : 'text-muted')}
          >
            {v ? 'Y' : 'N'}
          </button>
        ))}
      </span>
    </div>
  )
}

/** The corrigendum register form (everything except the number, which is
 *  automatic, and the derived counts). Controlled; never mutates `value`. */
export function RegisterFields({ value, onChange }: { value: CorrigendumRegister; onChange: (next: CorrigendumRegister) => void }) {
  const { data: members = [] } = useDeliveryTeamMembers()
  const set = <K extends keyof CorrigendumRegister>(key: K, v: CorrigendumRegister[K]) => onChange({ ...value, [key]: v })
  const owner = members.find((m) => m.id === value.reviewOwnerId)
  const toggleSection = (m: (typeof CORRIGENDUM_AFFECTED_MODULES)[number]) => set('affectedSections',
    value.affectedSections.includes(m) ? value.affectedSections.filter((s) => s !== m) : [...value.affectedSections, m])

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {DATES.map(([key, label]) => (
          <Field key={key} label={label}>
            <FriendlyDateInput aria-label={label} format="date" value={value[key] ?? ''} onChange={(v) => set(key, v || null)} />
          </Field>
        ))}
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-ink-800">Affected Sections</legend>
        <div className="flex flex-wrap gap-1.5">
          {CORRIGENDUM_AFFECTED_MODULES.map((m) => {
            const on = value.affectedSections.includes(m)
            return (
              <button key={m} type="button" aria-pressed={on} onClick={() => toggleSection(m)}
                className={cn('rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:focus-ring',
                  on ? 'border-blue bg-blue-50 text-blue-700' : 'border-line bg-white text-muted hover:text-ink')}>
                {CORRIGENDUM_MODULE_LABELS[m]}
              </button>
            )
          })}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Impact Level">
          <Select value={value.impactLevel} onChange={(e) => set('impactLevel', e.target.value as CorrigendumImpactLevel)}>
            {CORRIGENDUM_IMPACT_LEVELS.map((l) => <option key={l} value={l}>{CORRIGENDUM_IMPACT_LABELS[l]}</option>)}
          </Select>
        </Field>
        <Field label="Review Status">
          <Select value={value.reviewStatus} onChange={(e) => set('reviewStatus', e.target.value as CorrigendumReviewStatus)}>
            {CORRIGENDUM_REVIEW_STATUSES.map((s) => <option key={s} value={s}>{CORRIGENDUM_REVIEW_STATUS_LABELS[s]}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {FLAGS.map(([key, label]) => <YesNo key={key} label={label} value={value[key]} onChange={(v) => set(key, v)} />)}
      </div>
      <Field label="Review Owner">
        <div className="flex items-center gap-3">
          <Select value={value.reviewOwnerId ?? ''} onChange={(e) => set('reviewOwnerId', e.target.value || null)}>
            <option value="">— Unassigned —</option>
            {members.filter((m) => m.status === 'active' || m.id === value.reviewOwnerId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
          {owner && <PersonName person={owner} className="shrink-0" />}
        </div>
      </Field>
      <Field label="Remarks">
        <Textarea value={value.remarks} maxLength={4000} onChange={(e) => set('remarks', e.target.value)} />
      </Field>
    </div>
  )
}
