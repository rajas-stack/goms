import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { EMAIL_ATTACHMENT_LIMIT_BYTES, replyRecipients, type EmailEntityRef, type EmailItemRef, type EmailMailbox, type EmailMessage, type EmailUpload } from '@goms/domain'
import { Dialog } from '@/components/ui/Dialog'
import { InsertLink } from './InsertLink'
import { ComposeAttachment } from './emailUi'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { emailApi, emailQueryDefaults } from './api'

export interface ComposeStart { mode: 'new' | 'reply' | 'replyAll' | 'forward' | 'draft'; message?: EmailMessage; item?: EmailItemRef; draftId?: string; entity?: EmailEntityRef }
export function ComposeDialog({ email, mailboxes, start, onClose, onSaved }: { email: string; mailboxes: EmailMailbox[]; start: ComposeStart; onClose: () => void; onSaved: (message: string) => void }) {
  const [mailboxId, setMailboxId] = useState(mailboxes.find(mailbox => mailbox.id === start.item?.mailboxId)?.id ?? mailboxes[0]?.id ?? '')
  const initializedRecipients = useRef(false)
  const identities = useQuery({ ...emailQueryDefaults, refetchOnWindowFocus: false, queryKey: ['emailCenter', email, 'identities', mailboxId], enabled: !!mailboxId, queryFn: () => emailApi(email).identities.query({ mailboxId }) })
  const draft = useQuery({ ...emailQueryDefaults, refetchOnWindowFocus: false, queryKey: ['emailCenter', email, 'draft', mailboxId, start.draftId], enabled: start.mode === 'draft' && !!start.draftId && !!mailboxId, queryFn: () => emailApi(email).draft.query({ mailboxId, draftId: start.draftId! }) })
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [cc, setCc] = useState(''); const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState(start.message ? `${start.mode === 'forward' ? 'Fwd' : 'Re'}: ${start.message.subject.replace(/^(re|fwd?):\s*/i, '')}` : '')
  const [text, setText] = useState(start.message ? `\n\n${start.mode === 'forward' ? 'Forwarded message' : `On ${new Date(start.message.date).toLocaleString()}, ${start.message.from.map(person => person.email).join(', ')} wrote:`}\n${start.message.text}` : '')
  const [attachments, setAttachments] = useState<EmailUpload[]>([]); const [forwardAttachments, setForwardAttachments] = useState(false); const [keepDraftAttachments, setKeepDraftAttachments] = useState(true)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  /** Puts a line into the message at the cursor, on its own line. */
  const insertAtCursor = (line: string) => {
    const at = bodyRef.current?.selectionStart ?? text.length
    setText(value => { const before = value.slice(0, at); return before + (before && !before.endsWith('\n') ? '\n' : '') + line + '\n' + value.slice(at) })
  }
  const [draftId, setDraftId] = useState(start.draftId); const [draftMessageId, setDraftMessageId] = useState<string>()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID()); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState('')
  useEffect(() => { if (identities.data?.length && !identities.data.some(identity => identity.email === from)) setFrom(identities.data.find(identity => identity.primary)?.email ?? identities.data[0].email) }, [identities.data, from])
  useEffect(() => { if (!initializedRecipients.current && start.message && start.mode !== 'forward' && start.mode !== 'draft' && identities.data) { const recipients = replyRecipients(start.message, identities.data.map(identity => identity.email), start.mode === 'replyAll'); setTo(recipients.to.join(', ')); setCc(recipients.cc.join(', ')); initializedRecipients.current = true } }, [identities.data, start.message, start.mode])
  useEffect(() => { if (draft.data) { setTo(draft.data.to.map(person => person.email).join(', ')); setCc(draft.data.cc.map(person => person.email).join(', ')); setBcc(draft.data.bcc.map(person => person.email).join(', ')); setSubject(draft.data.subject === '(No subject)' ? '' : draft.data.subject); setText(draft.data.text); setDraftMessageId(draft.data.id); setFrom(draft.data.from[0]?.email ?? '') } }, [draft.data])
  function recipients(value: string) {
    const values = value.split(/[,;]+/).map(value => value.trim()).filter(Boolean)
    if (values.some(value => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value))) throw new Error('Use comma-separated email addresses in To, Cc and Bcc.')
    return [...new Set(values.map(value => value.toLowerCase()))]
  }
  async function upload(files: FileList | null) {
    if (!files) return
    setError('')
    try {
      const all = [...attachments]; let total = attachments.reduce((sum, file) => sum + file.data.length * 0.75, 0)
      for (const file of Array.from(files)) {
        total += file.size; if (total > EMAIL_ATTACHMENT_LIMIT_BYTES || all.length >= 20) throw new Error('Attachments may total up to 25 MB and 20 files (Gmail limit). Insert a link for larger files.')
        const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + 8192)))
        all.push({ name: file.name, mimeType: file.type || 'application/octet-stream', data: btoa(binary) })
      }
      setAttachments(all); setRequestId(crypto.randomUUID())
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read attachments.') }
  }
  async function submit(send: boolean) {
    if (busy) return; setBusy(true); setError(''); setSaved('')
    try {
      const input = { mailboxId, from, to: recipients(to), cc: recipients(cc), bcc: recipients(bcc), subject, text, attachments, requestId, draftId, draftMessageId, keepDraftAttachments, forwardAttachments,
        ...(start.message && start.item && ['reply', 'replyAll', 'forward'].includes(start.mode) ? { reply: { item: start.item, messageId: start.message.id, mode: start.mode as 'reply' | 'replyAll' | 'forward', entity: start.entity } } : {}) }
      if (send) { await emailApi(email).send.mutate({ ...input, confirmed: true }); onSaved('Email sent through Gmail.'); onClose() }
      else { const result = await emailApi(email).saveDraft.mutate(input); setDraftId(result.draftId); setDraftMessageId(result.messageId); setSaved('Saved in Gmail Drafts.'); onSaved('Draft saved in Gmail.'); setAttachments([]); setForwardAttachments(false) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete the email action.') } finally { setBusy(false) }
  }
  return <Dialog open onClose={() => { if (!busy) onClose() }} title={start.mode === 'new' ? 'Compose email' : start.mode === 'replyAll' ? 'Reply all' : start.mode === 'draft' ? 'Edit Gmail draft' : start.mode === 'forward' ? 'Forward email' : 'Reply'} size="xl">
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit(true) }}>
      {/* The sending mailbox is only a choice when more than one is connected. */}<div className={`grid gap-3 ${mailboxes.length > 1 ? 'sm:grid-cols-2' : ''}`}>{mailboxes.length > 1 && <Field label="Sending mailbox"><Select value={mailboxId} disabled={busy || !!draftId} onChange={event => { setMailboxId(event.target.value); setFrom('') }}>{mailboxes.map(mailbox => <option key={mailbox.id} value={mailbox.id}>{mailbox.email}</option>)}</Select></Field>}<Field label="From"><Select value={from} disabled={busy || identities.isLoading} onChange={event => setFrom(event.target.value)}>{identities.data?.map(identity => <option key={identity.email} value={identity.email}>{identity.email}</option>)}</Select></Field></div>
      <Field label="To" hint="Comma-separated email addresses"><Input disabled={busy} value={to} onChange={event => { setTo(event.target.value); setRequestId(crypto.randomUUID()) }} /></Field>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Cc"><Input disabled={busy} value={cc} onChange={event => setCc(event.target.value)} /></Field><Field label="Bcc"><Input disabled={busy} value={bcc} onChange={event => setBcc(event.target.value)} /></Field></div>
      <Field label="Subject"><Input disabled={busy} maxLength={500} value={subject} onChange={event => setSubject(event.target.value)} /></Field>
      <Field label="Message"><Textarea ref={bodyRef} disabled={busy} className="min-h-60" value={text} maxLength={500000} onChange={event => setText(event.target.value)} /></Field>
      <Field label="Large files (over 25 MB): insert a link"><InsertLink disabled={busy} onInsert={insertAtCursor} /></Field>
      <Field label="Attachments (up to 25 MB — Gmail limit)"><Input type="file" multiple disabled={busy} onChange={event => { void upload(event.target.files); event.target.value = '' }} /></Field>
      {attachments.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Attached files">{attachments.map((file, index) => <ComposeAttachment key={`${file.name}:${index}`} file={file} disabled={busy} onRemove={() => setAttachments(files => files.filter((_, i) => i !== index))} />)}</div>}
      {start.mode === 'forward' && !!start.message?.attachments.length && <label className="flex gap-2 text-sm"><input type="checkbox" checked={forwardAttachments} onChange={event => setForwardAttachments(event.target.checked)} />Include the original message’s attachments</label>}
      {start.mode === 'draft' && !!draft.data?.attachments.length && <label className="flex gap-2 text-sm"><input type="checkbox" checked={keepDraftAttachments} onChange={event => setKeepDraftAttachments(event.target.checked)} />Keep existing draft attachments ({draft.data.attachments.map(file => file.name).join(', ')})</label>}
      {(error || identities.error || draft.error) && <p role="alert" className="text-sm text-crimson">{error || identities.error?.message || draft.error?.message}</p>}{saved && <p role="status" className="text-sm text-muted">{saved}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Button disabled={busy} onClick={onClose}>Close</Button><Button disabled={busy || !from || !!draft.error || (start.mode === 'draft' && !draftMessageId) || identities.isError} onClick={() => void submit(false)}>Save draft</Button><Button variant="primary" type="submit" disabled={busy || !from || !!draft.error || (start.mode === 'draft' && !draftMessageId) || identities.isError}>{busy ? 'Working…' : 'Send email'}</Button></div>
    </form>
  </Dialog>
}
