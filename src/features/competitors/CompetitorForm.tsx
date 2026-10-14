import { useId, useState, type FormEvent, type ReactNode } from 'react'
import {
  assertUniqueCompetitorName, COMPETITOR_LIMITS, COMPETITOR_LIST_LIMITS, COMPETITOR_RELATIONSHIPS, COMPETITOR_RELATIONSHIP_LABEL,
  normalizeCompetitorInput, type Competitor, type CompetitorInput, type CompetitorListField, type CompetitorRelationship,
} from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { LogoField } from './LogoField'
import { TagInput } from './TagInput'

interface Props {
  existing: readonly Competitor[]
  editing?: Competitor
  busy: boolean
  onSubmit: (input: CompetitorInput) => Promise<unknown>
  onCancel: () => void
}

type Lists = Record<CompetitorListField, string[]>

const labelClass = 'mb-1.5 block text-[13px] font-medium text-ink-800'
const LIST_COPY: Record<CompetitorListField, { label: string; placeholder: string }> = {
  subCategories: { label: 'Sub-categories', placeholder: 'e.g. Data quality' },
  verticals: { label: 'Verticals', placeholder: 'e.g. BFSI, Government' },
  certifications: { label: 'Certifications', placeholder: 'e.g. ISO 27001, CMMI L5' },
  offerings: { label: 'Offerings', placeholder: 'e.g. Master data management' },
  strengths: { label: 'Key strengths', placeholder: 'e.g. Strong public-sector references' },
}

function Section({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-2xl border border-line bg-paper/60 p-4">
      <legend className="flex items-center gap-1.5 px-1 text-[12px] font-semibold uppercase tracking-wide text-goms-navy">
        <Icon name={icon} size={13} />{title}
      </legend>
      {children}
    </fieldset>
  )
}

/** Add / edit form, grouped into Company, Positioning and Capabilities; validated with the shared domain rules. */
export function CompetitorForm({ existing, editing, busy, onSubmit, onCancel }: Props) {
  const prefix = useId()
  const [name, setName] = useState(editing?.name ?? '')
  const [website, setWebsite] = useState(editing?.website ?? '')
  const [logo, setLogo] = useState<string | null>(editing?.logo ?? null)
  const [relationship, setRelationship] = useState<CompetitorRelationship>(editing?.relationship ?? 'competitor')
  const [category, setCategory] = useState(editing?.category ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [lists, setLists] = useState<Lists>({
    subCategories: editing?.subCategories ?? [], verticals: editing?.verticals ?? [], certifications: editing?.certifications ?? [],
    offerings: editing?.offerings ?? [], strengths: editing?.strengths ?? [],
  })
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(null)
    try {
      const clean = normalizeCompetitorInput({ name, website, logo, relationship, category, description, ...lists })
      assertUniqueCompetitorName(existing, clean.name, editing?.id)
      await onSubmit(clean)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the competitor.')
    }
  }

  const tagField = (field: CompetitorListField) => (
    <div>
      <label htmlFor={`${prefix}-${field}`} className={labelClass}>{LIST_COPY[field].label}</label>
      <TagInput id={`${prefix}-${field}`} label={LIST_COPY[field].label} limits={COMPETITOR_LIST_LIMITS[field]} value={lists[field]}
        placeholder={LIST_COPY[field].placeholder} disabled={busy} onError={setFieldError}
        onChange={next => setLists(current => ({ ...current, [field]: next }))} />
    </div>
  )

  return (
    <form aria-label={editing ? `Edit ${editing.name}` : 'Add competitor'} noValidate onSubmit={event => void save(event)} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Company" icon="Building2">
          <div>
            <label htmlFor={`${prefix}-name`} className={`${labelClass} after:ml-0.5 after:text-crimson after:content-['*']`}>Competitor name</label>
            <Input id={`${prefix}-name`} autoFocus value={name} maxLength={COMPETITOR_LIMITS.name} disabled={busy} placeholder="e.g. SAS"
              onChange={event => setName(event.target.value)} />
          </div>
          <div>
            <label htmlFor={`${prefix}-website`} className={labelClass}>Website</label>
            <Input id={`${prefix}-website`} type="url" inputMode="url" value={website} maxLength={COMPETITOR_LIMITS.url} disabled={busy}
              placeholder="https://www.sas.com" onChange={event => setWebsite(event.target.value)} />
          </div>
          <div>
            <span className={labelClass}>Logo</span>
            <LogoField name={name} value={logo} onChange={setLogo} disabled={busy} onError={setFieldError} />
          </div>
          <div>
            <label htmlFor={`${prefix}-description`} className={labelClass}>Notes</label>
            <Textarea id={`${prefix}-description`} value={description} maxLength={COMPETITOR_LIMITS.description} disabled={busy} rows={4}
              placeholder="Positioning, typical pricing, where we meet them in bids…" onChange={event => setDescription(event.target.value)} />
            <p className="mt-1 text-right text-xs text-muted">{description.length} / {COMPETITOR_LIMITS.description}</p>
          </div>
        </Section>
        <div className="space-y-4">
          <Section title="Positioning" icon="Flag">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={`${prefix}-relationship`} className={labelClass}>Relationship status</label>
                <div className="relative">
                  <Select id={`${prefix}-relationship`} value={relationship} disabled={busy}
                    onChange={event => setRelationship(event.target.value as CompetitorRelationship)}>
                    {COMPETITOR_RELATIONSHIPS.map(value => <option key={value} value={value}>{COMPETITOR_RELATIONSHIP_LABEL[value]}</option>)}
                  </Select>
                  <Icon name="ChevronDown" size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
                </div>
              </div>
              <div>
                <label htmlFor={`${prefix}-category`} className={labelClass}>Industry / category</label>
                <Input id={`${prefix}-category`} value={category} maxLength={COMPETITOR_LIMITS.category} disabled={busy}
                  placeholder="e.g. Data Management" onChange={event => setCategory(event.target.value)} />
              </div>
            </div>
            {tagField('subCategories')}
            {tagField('verticals')}
          </Section>
          <Section title="Capabilities" icon="Layers">
            {tagField('offerings')}
            {tagField('certifications')}
            {tagField('strengths')}
          </Section>
        </div>
      </div>
      {(fieldError || error) && (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-crimson-100 px-3 py-2 text-[13px] text-crimson">
          <Icon name="CircleAlert" size={14} className="mt-0.5 shrink-0" />{error ?? fieldError}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          <Icon name={editing ? 'Check' : 'Plus'} size={14} /> {busy ? 'Saving…' : editing ? 'Save changes' : 'Add competitor'}
        </Button>
      </div>
    </form>
  )
}
