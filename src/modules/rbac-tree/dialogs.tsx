import { useEffect, useState, type FormEvent } from 'react'
import type { RbacCustomRole, RbacRoleInput } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { errorText } from './api'

/** Name (+ optional description) for a template: create, rename, "save as template". */
export function NameDialog({ open, title, initialName = '', initialDescription = '', confirm, onClose, onSubmit }: {
  open: boolean; title: string; initialName?: string; initialDescription?: string; confirm: string
  onClose: () => void; onSubmit: (name: string, description: string) => Promise<unknown>
}) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setName(initialName); setDescription(initialDescription); setError(null) } }, [open, initialName, initialDescription])
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null)
    try { await onSubmit(name, description); onClose() } catch (err) { setError(errorText(err, 'Could not save.')) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label="Name" required><Input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description"><Textarea rows={3} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} /></Field>
        {error && <p role="alert" className="text-[13px] text-crimson">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" size="sm" disabled={busy || !name.trim()}>{confirm}</Button>
        </div>
      </form>
    </Dialog>
  )
}

const splitEmails = (text: string): string[] => text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)

/** Create / edit a custom role and its members (assigned by email). */
export function RoleDialog({ open, role, onClose, onSubmit }: {
  open: boolean; role: RbacCustomRole | null; onClose: () => void; onSubmit: (input: RbacRoleInput) => Promise<unknown>
}) {
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [members, setMembers] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setLabel(role?.label ?? ''); setDescription(role?.description ?? ''); setMembers((role?.members ?? []).join('\n')); setError(null)
  }, [open, role])
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(null)
    try { await onSubmit({ label, description, members: splitEmails(members) }); onClose() } catch (err) { setError(errorText(err, 'Could not save the role.')) }
  }
  return (
    <Dialog open={open} onClose={onClose} title={role ? `Edit ${role.label}` : 'New role'} description="Custom roles are given to people by email, alongside their functional roles.">
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label="Role name" required><Input autoFocus value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} /></Field>
        <Field label="Description"><Input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Members" hint="One email per line (or separated by commas).">
          <Textarea rows={5} value={members} onChange={(e) => setMembers(e.target.value)} placeholder="name@amnex.com" />
        </Field>
        {error && <p role="alert" className="text-[13px] text-crimson">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" size="sm" disabled={!label.trim()}>{role ? 'Save role' : 'Create role'}</Button>
        </div>
      </form>
    </Dialog>
  )
}
