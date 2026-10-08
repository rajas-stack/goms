import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Pencil, RotateCcw, Save, X } from 'lucide-react'
import type { BidSynopsis } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { PersonName } from '@/components/ui/PersonName'
import { cn } from '@/lib/utils'
import { useEntityLookups } from '../useEntityLookups'
import { useSaveSynopsis, useSynopsis } from './api'
import { GeneralFieldControl } from './GeneralFieldControl'
import { GeneralFieldValue } from './GeneralFieldValue'
import { documentToGeneral, GENERAL_FIELDS, GENERAL_GROUPS, generalToDocument } from './generalFields'

const NO_INVALID: ReadonlySet<string> = new Set()

function hasValues(values: Readonly<Record<string, string>>): boolean {
  return GENERAL_FIELDS.some(field => (values[field.key] ?? '').trim() !== '')
}

export function GeneralTab({ bidId }: { bidId: string }) {
  const query = useSynopsis(bidId, 'general')
  if (query.isLoading) return <div role="status" className="p-6 text-sm text-muted">Loading General...</div>
  if (query.isError) return <div role="alert" className="space-y-2 p-6 text-sm text-crimson"><p>{query.error.message}</p><Button size="sm" onClick={() => query.refetch()}>Retry</Button></div>
  return <GeneralForm key={bidId} bidId={bidId} saved={query.data ?? null} onReload={() => query.refetch()} />
}

/** Who last saved, shown with their avatar (Sales Team photo when the email matches). */
function UpdatedBy({ email }: { email: string }) {
  const { persons } = useEntityLookups()
  const person = persons.find(candidate => candidate.email?.toLowerCase() === email.toLowerCase())
  return <PersonName size="2xs" person={{ name: person?.label ?? email, photoUrl: person?.photoUrl ?? null }} />
}

function GeneralForm({ bidId, saved, onReload }: {
  bidId: string; saved: BidSynopsis | null; onReload: () => Promise<{ data?: BidSynopsis | null; error?: unknown }>
}) {
  const [base, setBase] = useState(() => ({ values: documentToGeneral(saved?.document), revision: saved?.revision ?? 0 }))
  const [values, setValues] = useState<Record<string, string>>(base.values)
  // Saved information opens locked; a new / empty General opens ready to fill in.
  const [editing, setEditing] = useState(() => !hasValues(base.values))
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(NO_INVALID)
  const [error, setError] = useState<string | null>(null)
  // Bumped whenever values are replaced wholesale, so controls drop any half-typed text.
  const [resetKey, setResetKey] = useState(0)
  const save = useSaveSynopsis()
  const dirty = useMemo(
    () => GENERAL_FIELDS.some(field => (values[field.key] ?? '').trim() !== (base.values[field.key] ?? '').trim()),
    [values, base],
  )

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const applySaved = (next: Record<string, string>, revision: number) => {
    setBase({ values: next, revision })
    setValues(next)
    setInvalid(NO_INVALID)
    setResetKey(key => key + 1)
    setEditing(!hasValues(next))
  }

  const submit = async () => {
    if (save.isPending || !editing) return
    if (invalid.size) { setError('Fix the highlighted dates before saving.'); return }
    setError(null)
    try {
      const record = await save.mutateAsync({ bidId, section: 'general', document: generalToDocument(values), expectedRevision: base.revision })
      applySaved(documentToGeneral(record.document), record.revision)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save General.') }
  }

  const cancel = () => {
    setValues(base.values)
    setInvalid(NO_INVALID)
    setError(null)
    setResetKey(key => key + 1)
    setEditing(!hasValues(base.values))
  }

  const reload = async () => {
    if (dirty && !window.confirm('Discard your unsaved changes and reload General?')) return
    setError(null)
    const result = await onReload()
    if (result.error) { setError('Could not reload the saved values. Your changes have been kept.'); return }
    applySaved(documentToGeneral(result.data?.document), result.data?.revision ?? 0)
  }

  const setValidity = (key: string, isInvalid: boolean) => setInvalid(current => {
    if (current.has(key) === isInvalid) return current
    const next = new Set(current)
    if (isInvalid) next.add(key); else next.delete(key)
    return next
  })

  return (
    <section aria-label="General" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-ink-900">General Information</h2>
          <span role="status" className={cn('inline-flex items-center gap-1.5 text-[12px]', dirty ? 'text-amber' : 'text-muted')}>
            {save.isPending ? <><Loader2 size={12} className="animate-spin" /> Saving...</>
              : dirty ? <><span className="h-1.5 w-1.5 rounded-full bg-amber" /> Unsaved changes</>
                : saved || base.revision ? <><Check size={12} className="text-emerald" /> Saved</> : 'Not saved yet'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" disabled={save.isPending} onClick={() => void reload()} aria-label="Reload saved values"><RotateCcw size={14} /></Button>
          {editing ? (
            <>
              {hasValues(base.values) && <Button size="sm" disabled={save.isPending} onClick={cancel}><X size={14} /> Cancel</Button>}
              <Button size="sm" variant="primary" disabled={save.isPending || !dirty || invalid.size > 0} onClick={() => void submit()}><Save size={14} /> Save</Button>
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</Button>
          )}
        </div>
      </div>
      {error && <div role="alert" className="border-y border-red-200 bg-red-50 px-4 py-2 text-[13px] text-crimson">{error}</div>}
      <form key={resetKey} className="space-y-6 px-4 pb-6" aria-readonly={!editing} onSubmit={event => { event.preventDefault(); void submit() }}>
        {GENERAL_GROUPS.map(group => (
          <fieldset key={group.title} disabled={save.isPending} className="rounded-lg border border-line bg-white disabled:opacity-70">
            <legend className="ml-3 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{group.title}</legend>
            <dl className="divide-y divide-line">
              {group.fields.map(field => (
                <div key={field.key} className={cn('grid gap-1.5 px-3 md:grid-cols-[minmax(180px,280px)_1fr] md:gap-4', editing ? 'py-2.5' : 'py-2')}>
                  <dt>
                    {editing
                      ? <label htmlFor={`general-${field.key}`} className="text-[13px] font-medium text-ink-800">{field.label}</label>
                      : <span className="text-[13px] font-medium text-ink-600">{field.label}</span>}
                  </dt>
                  <dd className={cn('min-w-0', !editing && 'text-[13px] text-ink-900')} data-field={field.key}>
                    {editing ? (
                      <GeneralFieldControl field={field} value={values[field.key] ?? ''}
                        onChange={value => setValues(current => ({ ...current, [field.key]: value }))}
                        onValidityChange={isInvalid => setValidity(field.key, isInvalid)} />
                    ) : <GeneralFieldValue field={field} value={values[field.key] ?? ''} />}
                  </dd>
                </div>
              ))}
            </dl>
          </fieldset>
        ))}
      </form>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-muted">
        <span>Revision {base.revision}</span>
        {saved?.updatedAt && <span>Saved {new Date(saved.updatedAt).toLocaleString('en-IN')}</span>}
        {saved?.updatedBy && <UpdatedBy email={saved.updatedBy} />}
      </div>
    </section>
  )
}
