import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { emailSourceUrl, type EmailAction, type EmailAttachment, type EmailEntityRef, type EmailItemRef, type EmailMailbox, type EmailMessage } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Select } from '@/components/ui/Field'
import { emailApi, emailQueryDefaults } from './api'
import { EmailLinkDialog } from './LinkDialog'
import { EmailParticipantPanel, EmailCategoryBadges } from './ParticipantPanel'
import { MissingStakeholders } from './MissingStakeholders'
import type { ComposeStart } from './ComposeDialog'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { IconAction } from './IconAction'
import { AttachmentCard, ImageThumb, MailAvatar, MailPersonName, MailTime, MotionIn } from './emailUi'

export function ConversationView({ email, item, entity, origin, supervisor, unlinked = false, capabilities, ownMailboxes, onCompose, onChanged }: {
  email: string; item: EmailItemRef; entity?: EmailEntityRef; origin?: EmailEntityRef; supervisor: boolean; unlinked?: boolean; capabilities: EmailAction[]; ownMailboxes: EmailMailbox[]; onCompose: (value: ComposeStart) => void; onChanged: () => void
}) {
  const query = useQuery({ ...emailQueryDefaults, queryKey: ['emailCenter', email, 'read', item, entity, supervisor, unlinked], queryFn: () => emailApi(email).read.query({ item, entity, supervisor, unlinked }), refetchInterval: 15000 })
  const history = useQuery({ ...emailQueryDefaults, queryKey: ['emailCenter', email, 'history', item], enabled: !!query.data?.mailbox.own, queryFn: () => emailApi(email).history.query({ item, entity, cursor: 0 }) })
  const [linking, setLinking] = useState<EmailItemRef | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ url: string; type: string; name: string } | null>(null)
  const [labelId, setLabelId] = useState('')
  const labels = useQuery({ ...emailQueryDefaults, queryKey: ['emailCenter', email, 'labels', item.mailboxId], enabled: !!query.data?.mailbox.own, queryFn: () => emailApi(email).labels.query({ mailboxId: item.mailboxId }) })
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url) }, [preview])
  if (query.isError) return <p role="alert" className="p-4 text-sm text-crimson">{query.error.message}</p>
  if (!query.data) return <p role="status" className="p-4 text-sm text-muted">Loading conversation…</p>
  const { conversation, mailbox, links } = query.data
  const can = (action: EmailAction) => capabilities.includes(action) && mailbox.capabilities.includes(action) && (mailbox.own || ['view', 'download', 'supervisor'].includes(action))
  async function run(action: () => Promise<unknown>) { setBusy(true); setError(''); try { await action(); await query.refetch(); onChanged() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete the action.') } finally { setBusy(false) } }
  async function attachment(message: EmailMessage, attachment: EmailAttachment, view: boolean) {
    setBusy(true); setError('')
    try {
      const data = await emailApi(email).attachment.query({ item, entity, supervisor, unlinked, messageId: message.id, attachmentId: attachment.id, partId: attachment.partId })
      const bytes = Uint8Array.from(atob(data.data.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)); const safePreview = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(data.mimeType)
      const blob = new Blob([bytes], { type: safePreview ? data.mimeType : 'application/octet-stream' }); const url = URL.createObjectURL(blob)
      if (view && safePreview) setPreview({ url, type: data.mimeType, name: data.name })
      else { const a = document.createElement('a'); a.href = url; a.download = data.name.replace(/[\\/\u0000-\u001f]/g, '_'); a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load attachment.') } finally { setBusy(false) }
  }
  const latest = conversation.messages[conversation.messages.length - 1]
  const starred = latest.labels.includes('STARRED'), unread = latest.labels.includes('UNREAD')
  const modify = (operation: Parameters<ReturnType<typeof emailApi>['modify']['mutate']>[0]['operation'], extra: { labelId?: string } = {}) => void run(() => emailApi(email).modify.mutate({ item, operation, ...extra }))
  const userLabels = labels.data?.filter(label => label.type === 'user') ?? []
  return <article className="space-y-6 px-6 py-6">
    <header className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="break-words text-xl font-semibold leading-snug text-ink-900">{conversation.subject || '(No subject)'}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted"><Icon name="MessageSquareText" size={13} />{conversation.messages.length} message{conversation.messages.length === 1 ? '' : 's'}<span aria-hidden>·</span>{query.isFetching ? 'Refreshing…' : 'Live from Gmail'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {can('link') && <IconAction icon="Link2" label={`Link ${item.kind} to a record`} variant="ghost" disabled={busy} onClick={() => setLinking(item)} />}
          <Tooltip label="Open in Gmail"><a aria-label="Open in Gmail" href={emailSourceUrl(mailbox.email, item.kind, item.id)} target="_blank" rel="noopener noreferrer" className="grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-ink-900/[0.05] hover:text-ink-900"><Icon name="ExternalLink" size={16} /></a></Tooltip>
        </div>
      </div>
      <div role="toolbar" aria-label="Conversation actions" className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-white/70 p-1">
        {can('send') && ownMailboxes.length > 0 && <>
          <IconAction icon="Reply" label="Reply" variant="ghost" onClick={() => onCompose({ mode: 'reply', message: latest, item, entity })} />
          <IconAction icon="ReplyAll" label="Reply all" variant="ghost" onClick={() => onCompose({ mode: 'replyAll', message: latest, item, entity })} />
          <IconAction icon="Forward" label="Forward" variant="ghost" onClick={() => onCompose({ mode: 'forward', message: latest, item, entity })} />
        </>}
        {mailbox.own && can('manageMailbox') && <>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <IconAction icon="Star" label={starred ? 'Unstar' : 'Star'} variant="ghost" className={starred ? 'text-amber-500' : undefined} disabled={busy} onClick={() => modify(starred ? 'unstar' : 'star')} />
          <IconAction icon={unread ? 'MailOpen' : 'Mail'} label={unread ? 'Mark read' : 'Mark unread'} variant="ghost" disabled={busy} onClick={() => modify(unread ? 'read' : 'unread')} />
          <IconAction icon="Archive" label="Archive" variant="ghost" disabled={busy} onClick={() => modify('archive')} />
          {userLabels.length > 0 && <>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            <Select aria-label="Gmail label" value={labelId} className="h-8 w-auto max-w-44 text-[13px]" onChange={event => setLabelId(event.target.value)}><option value="">Label…</option>{userLabels.map(label => <option key={label.id} value={label.id}>{label.name}</option>)}</Select>
            {labelId && <><IconAction icon="Bookmark" label="Apply label" variant="ghost" disabled={busy} onClick={() => modify('addLabel', { labelId })} /><IconAction icon="X" label="Remove label" variant="ghost" disabled={busy} onClick={() => modify('removeLabel', { labelId })} /></>}
          </>}
        </>}
      </div>
    </header>
    {error && <p role="alert" className="text-sm text-crimson">{error}</p>}
    {links.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Associated records">{links.map(link => <div key={`${link.id}:${link.item.kind}:${link.item.id}`} className="inline-flex items-center gap-2 rounded border border-line px-2 py-1 text-xs"><Link className="underline" to={link.entity.path}>{link.entity.title}</Link><span className="text-muted">{link.item.kind}{link.copy ? ' · my delivered copy' : ''}</span>{link.own && can('unlink') && <button disabled={busy} className="underline" onClick={() => void run(() => emailApi(email).unlink.mutate({ id: link.id, confirmed: true }))}>Unlink</button>}</div>)}</div>}
    <div className="space-y-3">{conversation.messages.map((message, index) => {
      const sender = message.from[0] ?? { name: 'Sender unavailable', email: '' }
      const recipients = [...message.to, ...message.cc]
      return <MotionIn key={message.id} delay={index * 0.03}>
        <details open={index === conversation.messages.length - 1} className="group/msg rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(11,43,73,0.04)] [&[open]]:shadow-[0_6px_20px_rgba(11,43,73,0.06)]">
          <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
            <MailPersonName person={sender} size="md" className="flex-1" subtitle={<span className="flex min-w-0 items-center gap-1">to {recipients.slice(0, 3).map(p => p.name || p.email).join(', ') || 'undisclosed'}{recipients.length > 3 && ` +${recipients.length - 3}`}</span>} />
            <span className="flex shrink-0 items-center gap-2">
              {!!message.attachments.length && <Tooltip label={`${message.attachments.length} attachment${message.attachments.length === 1 ? '' : 's'}`}><Icon name="Paperclip" size={14} className="text-muted" /></Tooltip>}
              <MailTime iso={message.date} />
            </span>
          </summary>
          <div className="space-y-4 px-5 pb-5">
            {(message.cc.length > 0 || message.bcc.length > 0) && <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
              {message.cc.length > 0 && <><span className="font-medium">Cc</span>{message.cc.map(p => <MailAvatar key={p.email} person={p} size="xs" />)}</>}
              {message.bcc.length > 0 && <><span className="ml-2 font-medium">Bcc</span>{message.bcc.map(p => <MailAvatar key={p.email} person={p} size="xs" />)}</>}
            </div>}
            <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-7 text-ink-900">{message.text || message.snippet || 'No text content.'}</pre>
            {!!message.attachments.length && <div className="flex flex-wrap gap-2" aria-label="Attachments">{message.attachments.map(file => {
              const previewable = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(file.mimeType)
              // Images render inline as thumbnails (fetched with the same authorized attachment call).
              if (can('download') && /^image\/(png|jpeg|gif|webp)$/.test(file.mimeType) && file.size <= 10 * 1024 * 1024) return <ImageThumb key={`${file.id}:${file.partId}`} name={file.name} size={file.size}
                load={() => emailApi(email).attachment.query({ item, entity, supervisor, unlinked, messageId: message.id, attachmentId: file.id, partId: file.partId })}
                onOpen={() => void attachment(message, file, true)} onDownload={() => void attachment(message, file, false)} />
              return <AttachmentCard key={`${file.id}:${file.partId}`} name={file.name} mime={file.mimeType} size={file.size} disabled={busy || !can('download')}
                onOpen={can('download') ? () => void attachment(message, file, previewable) : undefined} onDownload={can('download') ? () => void attachment(message, file, false) : undefined} />
            })}</div>}
            {can('link') && <div className="flex justify-end"><IconAction icon="Link2" label="Link only this message" variant="ghost" onClick={() => setLinking({ mailboxId: item.mailboxId, kind: 'message', id: message.id })} /></div>}
          </div>
        </details>
      </MotionIn>
    })}</div>
    <EmailCategoryBadges participants={conversation.messages.flatMap(message => [...message.from, ...message.to, ...message.cc])} ownerEmail={mailbox.ownerEmail} />
    {entity?.type === 'opportunity' && <MissingStakeholders email={email} entity={entity} message={latest} canSuggest={can('link')} />}
    <EmailParticipantPanel messages={conversation.messages} ownerEmail={mailbox.ownerEmail} />
    {mailbox.own && <details><summary className="cursor-pointer text-sm text-muted">Correspondence and relationship history</summary>{history.data?.items.map((event, i) => <p key={i} className="mt-2 text-xs text-muted">{new Date(event.at).toLocaleString()} · {event.action.replace(/_/g, ' ')}{event.entity ? ` · ${event.entity.title}` : ''}</p>)}{history.error && <p className="text-xs text-crimson">{history.error.message}</p>}</details>}
    {linking && <EmailLinkDialog email={email} item={linking} origin={origin ?? entity} canShare={can('share')} onClose={() => setLinking(null)} onLinked={() => { void query.refetch(); onChanged() }} />}
    {preview && <Dialog open onClose={() => setPreview(null)} title={preview.name} size="xl">{preview.type.startsWith('image/') ? <img src={preview.url} alt={preview.name} className="max-h-[70vh] w-full object-contain" /> : <iframe title={preview.name} src={preview.url} sandbox="" className="h-[65vh] w-full" />}</Dialog>}
  </article>
}
