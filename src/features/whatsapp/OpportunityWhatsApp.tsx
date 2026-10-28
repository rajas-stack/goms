import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { repository } from '@/data/repository'
import { Avatar } from '@/components/ui/Avatar'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import type { WhatsAppLink } from '@/lib/types'
import { useEffect, useRef, useState } from 'react'
import { authApi, useAuthUser } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { base64ToBytes, bytesToBase64 } from '@/data/in-memory/makerDocuments'
import { formatPhone, KEEP_FILE_BYTES, LOCAL_SESSION, MEDIA_TYPES, nameMentions, sessionName, whatsappApi, whoIs } from './api'
import { DocumentViewer, fileName, previewOf, type ChatFile } from './Attachments'

const TYPE: Record<string, { label: string; icon: string }> = {
  image: { label: 'Photo', icon: 'FileImage' }, video: { label: 'Video', icon: 'Video' }, audio: { label: 'Audio', icon: 'PhoneCall' },
  voice: { label: 'Voice message', icon: 'PhoneCall' }, document: { label: 'Document', icon: 'FileText' }, sticker: { label: 'Sticker', icon: 'FileImage' },
  location: { label: 'Location', icon: 'MapPin' }, contact: { label: 'Contact', icon: 'IdCard' }, poll: { label: 'Poll', icon: 'List' },
}

/** The filed attachment: the copy kept with it, else fetched from WhatsApp (messages filed before copies were kept). */
async function loadFile(link: WhatsAppLink, session: string): Promise<ChatFile> {
  const named = (blob: Blob): ChatFile => ({
    blob, mimetype: blob.type, sizeBytes: blob.size,
    filename: link.filename || fileName({ type: link.type, timestamp: Date.parse(link.sentAt) / 1000 }, { mimetype: blob.type }),
  })
  if (link.file) return named(new Blob([base64ToBytes(link.file.base64) as Uint8Array<ArrayBuffer>], { type: link.file.mimetype }))
  const current = await whatsappApi.find(session)
  if (current?.status !== 'ready') throw new Error('Link WhatsApp first: this message was filed before GOMS kept a copy of its file.')
  try {
    return named(await whatsappApi.storedFile(current.id, link.chatId, link.messageId))
  } catch {
    const media = (await whatsappApi.attachments(current.id, link.chatId)).get(link.messageId)
    if (!media?.data) throw new Error('WhatsApp can no longer provide this file. Open it on your phone.')
    return named(new Blob([base64ToBytes(media.data) as Uint8Array<ArrayBuffer>], { type: media.mimetype }))
  }
}

const MENTION = /@(\d{8,})/
const numberOnly = (link: WhatsAppLink) => !link.fromMe && /^\+\d+$/.test(link.senderName)
const needsRepair = (link: WhatsAppLink) => link.addedBy === 'This computer' || numberOnly(link) || MENTION.test(link.body)
/** Who digits stored as a "phone" really are: a privacy id (@lid) first, then a phone (@c.us). */
async function resolve(sessionId: string, digits: string) {
  const lid = await whoIs(sessionId, `${digits}@lid`)
  return lid.name || lid.phone ? lid : whoIs(sessionId, `${digits}@c.us`)
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** The WhatsApp messages filed to this opportunity (right-click a message in WhatsApp › Add to opportunity). */
export function OpportunityWhatsApp({ opportunityId }: { opportunityId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const key = ['whatsappLinks', opportunityId]
  const links = useQuery({ queryKey: key, queryFn: () => repository.listWhatsAppLinks(opportunityId) })
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const { user } = useAuthUser()
  const session = authApi.configured && user?.email ? sessionName(user.email.toLowerCase()) : LOCAL_SESSION
  const [busy, setBusy] = useState<string | null>(null)
  const [viewing, setViewing] = useState<{ id: string; file: ChatFile } | null>(null)

  /** View opens the file in the chat's viewer (Excel as a sheet, Word as a document…); Download saves it. */
  const openFile = async (link: WhatsAppLink, mode: 'view' | 'download') => {
    setBusy(`${link.id}:${mode}`)
    try {
      const file = await loadFile(link, session)
      // Fetched from WhatsApp: keep a copy now, so it opens instantly next time and after WhatsApp lets it expire.
      if (!link.file && file.blob && file.blob.size <= KEEP_FILE_BYTES) {
        void repository.updateWhatsAppLink(link.id, { file: { mimetype: file.mimetype, base64: bytesToBase64(new Uint8Array(await file.blob.arrayBuffer())) } }).then(refresh)
      }
      if (mode === 'view' && previewOf(file)) { setViewing({ id: link.id, file }); return }
      const url = URL.createObjectURL(file.blob!)
      const anchor = Object.assign(document.createElement('a'), { href: url, download: file.filename })
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      if (mode === 'view') toast('This file type cannot be shown here, so it was downloaded.')
    } catch (error) {
      toast(`Could not open the file: ${(error as Error).message}`, undefined, 'error')
    } finally { setBusy(null) }
  }

  // Older cards fix themselves: a sender shown as a number, mentions shown as ids, "This computer" as who filed it.
  const checked = useRef(new Set<string>())
  useEffect(() => {
    const stale = (links.data ?? []).filter((link) => !checked.current.has(link.id) && needsRepair(link))
    if (stale.length === 0) return
    stale.forEach((link) => checked.current.add(link.id))
    void (async () => {
      const current = await whatsappApi.find(session).catch(() => null)
      const live = current?.status === 'ready' ? current.id : null
      const filer = user?.displayName || user?.email || current?.pushName
      for (const link of stale) {
        const patch: Parameters<typeof repository.updateWhatsAppLink>[1] = {}
        if (link.addedBy === 'This computer' && filer) patch.addedBy = filer
        if (live && numberOnly(link) && link.senderPhone) {
          const who = await resolve(live, link.senderPhone)
          if (who.name || who.phone) Object.assign(patch, { senderName: who.name ?? formatPhone(who.phone ?? ""), senderPhone: who.phone })
        }
        if (live && MENTION.test(link.body)) {
          // Old filings kept no mention ids: long ones are privacy ids (@lid), the rest phones (@c.us).
          const ids = [...link.body.matchAll(new RegExp(MENTION, 'g'))].flatMap(([, digits]) => [`${digits}@lid`, `${digits}@c.us`])
          const body = await nameMentions(live, link.body, ids)
          if (body !== link.body) patch.body = body
        }
        if (Object.keys(patch).length) await repository.updateWhatsAppLink(link.id, patch)
      }
      void refresh()
    })().catch(() => undefined) // best effort: a card that cannot be fixed stays as it is
    // Runs when the list changes; `checked` keeps each card to one attempt per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links.data])

  const remove = async (link: WhatsAppLink) => {
    try {
      await repository.removeWhatsAppLink(link.id)
      await refresh()
      const { id: _id, addedAt: _addedAt, ...input } = link
      toast('Removed from this opportunity', { label: 'Undo', onClick: () => void repository.addWhatsAppLink(input).then(refresh) })
    } catch (error) { toast(`Could not remove it: ${(error as Error).message}`, undefined, 'error') }
  }

  return (
    <section aria-labelledby="opportunity-whatsapp" className="mb-4 rounded-xl border border-line bg-panel/60 p-3">
      <h2 id="opportunity-whatsapp" className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon name="MessageCircle" size={16} className="text-emerald-600" />WhatsApp
        {links.data && links.data.length > 0 && <span className="rounded-full bg-emerald-600/15 px-2 text-[11px] font-semibold tabular-nums text-emerald-700">{links.data.length}</span>}
      </h2>
      {links.isPending && <p className="text-[13px] text-muted">Loading…</p>}
      {links.isError && <p role="alert" className="text-[13px] text-crimson">Could not load WhatsApp messages: {links.error.message}</p>}
      {links.data?.length === 0 && (
        <p className="text-[13px] text-muted">No WhatsApp messages yet. In WhatsApp, right-click a message and choose <b>Add to opportunity</b>.</p>
      )}
      <ul className="space-y-2">
        {links.data?.map((link) => {
          const kind = TYPE[link.type]
          const sameChat = link.chatName === link.senderName
          return (
            <motion.li key={link.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <article aria-label={`WhatsApp message from ${link.senderName}`} className="rounded-xl border border-line/70 bg-white p-3 shadow-sm">
                <header className="flex items-start gap-3">
                  {/* A number with no name would show "++" as initials. */}
                  {link.senderName.startsWith('+')
                    ? <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-900/10 text-ink-600"><Icon name="User" size={15} /></span>
                    : <Avatar person={{ name: link.senderName }} size="sm" />}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="truncate text-sm font-semibold text-ink">{link.fromMe ? `${link.senderName} (you)` : link.senderName}</span>
                      {link.senderPhone && <span className="text-[12px] tabular-nums text-muted">{formatPhone(link.senderPhone)}</span>}
                    </p>
                    <p className="text-[12px] text-muted">
                      <time dateTime={link.sentAt}>{day(link.sentAt)} · {time(link.sentAt)}</time>{!sameChat && <> · in {link.chatName}</>}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-600/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    <Icon name="MessageCircle" size={11} />WhatsApp
                  </span>
                </header>
                {kind && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                    <span className="flex min-w-0 items-center gap-1.5 font-medium text-ink-700"><Icon name={kind.icon} size={13} /><span className="truncate">{link.filename || kind.label}</span></span>
                    {MEDIA_TYPES.has(link.type) && (['view', 'download'] as const).map((mode) => (
                      <button key={mode} type="button" disabled={busy !== null} onClick={() => void openFile(link, mode)}
                        className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 font-semibold text-ink-700 transition hover:border-emerald-600/50 hover:text-ink disabled:opacity-50">
                        <Icon name={busy === `${link.id}:${mode}` ? 'Loader' : mode === 'view' ? 'Eye' : 'Download'} size={12} className={cn(busy === `${link.id}:${mode}` && 'animate-spin')} />
                        {mode === 'view' ? 'View' : 'Download'}
                      </button>
                    ))}
                  </div>
                )}
                {link.body && link.body !== link.filename && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-ink line-clamp-6">{link.body}</p>}
                <footer className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/70 pt-2 text-[12px] text-muted">
                  <span>Added by {link.addedBy} · {day(link.addedAt)}</span>
                  <span className="ml-auto" />
                  <button type="button" onClick={() => navigate(`/whatsapp?chat=${encodeURIComponent(link.chatId)}`)} className="inline-flex items-center gap-1 font-semibold text-ink-700 hover:underline">
                    <Icon name="ExternalLink" size={12} />Open in WhatsApp
                  </button>
                  <button type="button" onClick={() => void remove(link)} className="inline-flex items-center gap-1 font-semibold text-crimson hover:underline">
                    <Icon name="Trash2" size={12} />Remove
                  </button>
                </footer>
              </article>
            </motion.li>
          )
        })}
      </ul>
      {viewing && <DocumentViewer id={`link-${viewing.id}`} file={viewing.file} onClose={() => setViewing(null)} />}
    </section>
  )
}
