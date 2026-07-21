import { useEffect, useRef, useState } from 'react'
import { useEmployee, useEmployeeMutations } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { cn, uid } from '@/lib/utils'
import { extractContact } from './contact-ocr'
import type { Employee, VisitingCardItem } from '@/lib/types'

const ACCEPT = 'image/*,application/pdf'

const isPdf = (url: string | null, name: string | null) =>
  !!url?.startsWith('data:application/pdf') || !!name?.toLowerCase().endsWith('.pdf')

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

type Pending = { kind: 'new' } | { kind: 'front' | 'back'; cardId: string }

/** User-managed visiting cards. Uploads, replacements, and removals are staged
 *  in local draft state — nothing persists until the user clicks Save. A person
 *  can hold several cards, each with a front (required) and an optional back.
 *  "Pick up contact" runs OCR and (because it writes employee fields, not the
 *  card list) applies immediately. */
export function VisitingCard({ employeeId }: { employeeId: string }) {
  const { data: emp } = useEmployee(employeeId)
  const { update } = useEmployeeMutations()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const pending = useRef<Pending | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState<VisitingCardItem[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // Reset the draft whenever a different employee's cards load, so the staged
  // list always starts from what's actually persisted.
  useEffect(() => {
    if (emp) {
      setDraft(emp.visitingCards ?? [])
      setDirty(false)
    }
  }, [emp?.id, emp?.visitingCards])

  if (!emp) return null
  const cards = draft

  function stage(next: VisitingCardItem[]) {
    setDraft(next)
    setDirty(true)
  }

  function pick(action: Pending) {
    pending.current = action
    fileRef.current?.click()
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    const action = pending.current
    pending.current = null
    if (!file || !action) return
    const dataUrl = await readFile(file)

    if (action.kind === 'new') {
      const card: VisitingCardItem = { id: uid('card'), frontUrl: dataUrl, frontName: file.name, backUrl: null, backName: null }
      stage([...cards, card])
      return
    }
    stage(cards.map((c) => {
      if (c.id !== action.cardId) return c
      return action.kind === 'front'
        ? { ...c, frontUrl: dataUrl, frontName: file.name }
        : { ...c, backUrl: dataUrl, backName: file.name }
    }))
  }

  function removeCard(cardId: string) {
    stage(cards.filter((c) => c.id !== cardId))
  }

  function removeBack(cardId: string) {
    stage(cards.map((c) => (c.id === cardId ? { ...c, backUrl: null, backName: null } : c)))
  }

  async function save() {
    setSaving(true)
    try {
      await update.mutateAsync({ id: emp!.id, patch: { visitingCards: draft } })
      setDirty(false)
      toast('Visiting cards saved')
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setDraft(emp!.visitingCards ?? [])
    setDirty(false)
  }

  async function pickup(card: VisitingCardItem) {
    if (busy) return
    setBusy(card.id)
    toast('Reading card…')
    try {
      const urls = [card.frontUrl, card.backUrl].filter((u): u is string => !!u)
      const found = await extractContact(urls)
      const patch: Partial<Employee> = {}
      if (found.email) patch.email = found.email
      if (found.phone) patch.phone = found.phone
      if (found.name && !emp!.name) patch.name = found.name
      if (found.designation && !emp!.designation) patch.designation = found.designation
      const keys = Object.keys(patch)
      if (keys.length === 0) {
        toast('No contact details found on the card')
        return
      }
      await update.mutateAsync({ id: emp!.id, patch })
      toast(`Picked up ${keys.join(', ')}`)
    } catch {
      toast('Could not read the card — check the image or enter details manually')
    } finally {
      setBusy(null)
    }
  }

  function view(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
  function download(url: string, name: string | null) {
    const a = document.createElement('a')
    a.href = url
    a.download = name ?? `${emp!.name.replace(/\s+/g, '-').toLowerCase()}-visiting-card`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="space-y-4">
      <input ref={fileRef} type="file" accept={ACCEPT} onChange={onFile} className="hidden" />

      {cards.length === 0 && (
        <p className="text-sm text-muted">No visiting cards yet. Upload the front (and optionally the back) of a card.</p>
      )}

      <div className="space-y-4">
        {cards.map((card, i) => (
          <div key={card.id} className="overflow-hidden rounded-2xl border border-line bg-white shadow-panel">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <span className="text-[13px] font-semibold text-ink-900">Card {i + 1}</span>
              <div className="flex items-center gap-1">
                <Button size="sm" onClick={() => pickup(card)} disabled={!!busy}>
                  <Icon name="Sparkles" size={14} /> {busy === card.id ? 'Reading…' : 'Pick up contact'}
                </Button>
                <Button size="sm" variant="ghost" className="text-crimson hover:bg-crimson-100" onClick={() => removeCard(card.id)}>
                  <Icon name="Trash2" size={14} /> Remove
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
              <CardSide
                label="Front" url={card.frontUrl} name={card.frontName}
                onReplace={() => pick({ kind: 'front', cardId: card.id })}
                onView={() => view(card.frontUrl)}
                onDownload={() => download(card.frontUrl, card.frontName)}
              />
              {card.backUrl ? (
                <CardSide
                  label="Back" url={card.backUrl} name={card.backName}
                  onReplace={() => pick({ kind: 'back', cardId: card.id })}
                  onView={() => view(card.backUrl!)}
                  onDownload={() => download(card.backUrl!, card.backName)}
                  onRemove={() => removeBack(card.id)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => pick({ kind: 'back', cardId: card.id })}
                  className="flex min-h-[8rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-white/60 text-center transition-colors hover:border-ink-600 hover:bg-white"
                >
                  <Icon name="Plus" size={18} className="text-muted" />
                  <span className="text-[13px] font-medium text-ink-800">Add back side</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <Button size="sm" onClick={() => pick({ kind: 'new' })}>
          <Icon name="Upload" size={14} /> Add visiting card
        </Button>
        <div className="flex items-center gap-2">
          {dirty && (
            <Button size="sm" variant="ghost" onClick={discard} disabled={saving}>Discard</Button>
          )}
          <Button size="sm" variant="primary" onClick={save} disabled={!dirty || saving}>
            <Icon name="Check" size={14} /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      {dirty && (
        <p className="text-[12px] text-amber-600">You have unsaved changes. Click Save to keep them.</p>
      )}
    </div>
  )
}

function CardSide({ label, url, name, onReplace, onView, onDownload, onRemove }: {
  label: string
  url: string
  name: string | null
  onReplace: () => void
  onView: () => void
  onDownload: () => void
  onRemove?: () => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex items-center justify-between border-b border-line bg-panel/40 px-2.5 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
        <div className="flex items-center gap-0.5">
          <IconBtn icon="Upload" label="Replace" onClick={onReplace} />
          <IconBtn icon="ExternalLink" label="View" onClick={onView} />
          <IconBtn icon="Download" label="Download" onClick={onDownload} />
          {onRemove && <IconBtn icon="Trash2" label="Remove" onClick={onRemove} danger />}
        </div>
      </div>
      {isPdf(url, name) ? (
        <iframe src={url} title={label} className="h-40 w-full border-0 bg-panel" />
      ) : (
        <img src={url} alt={label} className="h-40 w-full bg-panel object-contain" />
      )}
    </div>
  )
}

function IconBtn({ icon, label, onClick, danger }: {
  icon: string
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn('rounded p-1 text-muted hover:bg-ink-900/[0.06] hover:text-ink', danger && 'hover:bg-crimson-100 hover:text-crimson')}
    >
      <Icon name={icon} size={14} />
    </button>
  )
}
