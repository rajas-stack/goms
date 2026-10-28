import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import { chatPhone, formatPhone, MEDIA_TYPES, whatsappApi, whoIs, type WhatsAppChat, type WhatsAppGroupInfo, type WhatsAppMessage } from './api'
import type { ChatContext } from './MessageMenu'
import { ChatTagMenu, type Tags } from './Tags'
import { MediaLibrary } from './MediaLibrary'
import { readStarred } from './starredMessages'
import { isContactCard } from './mediaLibraryModel'

const ROSTER_STALE_MS = 10 * 60_000
const MUTE_FOREVER = Number.MAX_SAFE_INTEGER
const nameOf = (chat: WhatsAppChat) => chat.name || chatPhone(chat.id)

/** Whether a group has this person in it, by WhatsApp id or (for a privacy …@lid chat) by phone. */
export const hasMember = (group: WhatsAppGroupInfo, chatId: string, phone: string | null) =>
  group.participants.some((member) => member.id === chatId || (!!phone && member.number === phone))

/** The loaded messages as text, oldest first, the way WhatsApp's own export reads. */
export const transcript = (messages: WhatsAppMessage[], senderOf: (message: WhatsAppMessage) => string) =>
  [...messages].sort((a, b) => a.timestamp - b.timestamp)
    .map((message) => `[${new Date(message.timestamp * 1000).toLocaleString()}] ${senderOf(message)}: ${message.body || `<${message.type}>`}`).join('\n')

// shortcut: the gateway can mute but not report mute state, so only mutes made in GOMS show; read it from OpenWA once it exposes one.
const muteKey = (sessionId: string) => `goms:whatsapp:muted:${sessionId}`
function readMuted(sessionId: string): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(muteKey(sessionId)) ?? '{}') ?? {} } catch { return {} }
}

interface Props {
  context: ChatContext; photoUrl?: string | null; pictures: Record<string, string | null>; tags: Tags
  messages: WhatsAppMessage[]; senderOf: (message: WhatsAppMessage) => string
  onOpenChat: (chat: WhatsAppChat) => void; onJump: (messageId: string) => void; onClose: () => void; onDeleted: () => void
}

/** WhatsApp's "Contact info" / "Group info": a panel sliding in over the conversation's right side. */
export function ContactInfo({ context, photoUrl, pictures, tags, messages, senderOf, onOpenChat, onJump, onClose, onDeleted }: Props) {
  const { sessionId, chat } = context
  const reduceMotion = useReducedMotion()
  const closeButton = useRef<HTMLButtonElement>(null)
  const [mediaOpen, setMediaOpen] = useState(false)
  const [listMenu, setListMenu] = useState<{ x: number; y: number } | null>(null)
  const [confirm, setConfirm] = useState<'block' | 'delete' | null>(null)
  const [showStarred, setShowStarred] = useState(false)
  useEffect(() => { closeButton.current?.focus() }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !mediaOpen && !confirm && !listMenu) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, mediaOpen, confirm, listMenu])

  const who = useQuery({ queryKey: ['whatsapp', sessionId, 'who', chat.id], queryFn: () => whoIs(sessionId, chat.id), enabled: !chat.isGroup, staleTime: Infinity })
  const phone = chat.isGroup ? null : who.data?.phone ?? (chat.id.endsWith('@c.us') ? chat.id.split('@')[0] : null)
  const starred = readStarred(sessionId).filter((item) => item.chat.id === chat.id)
  const mediaCount = messages.filter((message) => MEDIA_TYPES.has(message.type) || isContactCard(message) || /https?:\/\//.test(message.body)).length
  const exportChat = () => {
    const url = URL.createObjectURL(new Blob([transcript(messages, senderOf)], { type: 'text/plain' }))
    Object.assign(document.createElement('a'), { href: url, download: `WhatsApp chat with ${nameOf(chat)}.txt` }).click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  return <>
    <motion.aside aria-label={chat.isGroup ? 'Group info' : 'Contact info'}
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={reduceMotion ? { duration: 0 } : { type: 'tween', duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-line bg-white shadow-2xl sm:w-[26rem]">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <button ref={closeButton} type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1.5 hover:bg-ink-900/[0.06] focus-visible:focus-ring"><Icon name="X" size={18} /></button>
        <h2 className="text-sm font-semibold text-ink">{chat.isGroup ? 'Group info' : 'Contact info'}</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="flex flex-col items-center gap-1 px-6 py-6 text-center">
          <Avatar person={{ name: nameOf(chat), photoUrl }} size="lg" className="mb-2 h-24 w-24 text-3xl" />
          <p className="text-lg font-semibold text-ink">{nameOf(chat)}</p>
          {phone && <p className="text-sm text-muted">{formatPhone(phone)}</p>}
          {chat.isGroup && <GroupDescription sessionId={sessionId} groupId={chat.id} />}
        </section>
        <Divider />
        <Row icon="FileImage" label="Media, links and docs" detail={String(mediaCount)} onClick={() => setMediaOpen(true)} />
        <Row icon="Star" label="Starred messages" detail={String(starred.length)} onClick={() => setShowStarred((open) => !open)} expanded={showStarred} />
        {showStarred && (
          <ul className="space-y-1 px-4 pb-2">
            {starred.map(({ message }) => <li key={message.id}>
              <button type="button" onClick={() => onJump(message.id)} className="w-full rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-ink-900/[0.04] focus-visible:focus-ring">
                <span className="line-clamp-2 break-words">{message.body || message.type}</span>
                <span className="mt-0.5 block text-[11px] text-muted">{new Date(message.timestamp * 1000).toLocaleString()}</span>
              </button>
            </li>)}
            {!starred.length && <li className="py-2 text-center text-xs text-muted">No starred messages in this chat.</li>}
          </ul>
        )}
        <MuteRow sessionId={sessionId} chatId={chat.id} />
        <Divider />
        {chat.isGroup
          ? <Members sessionId={sessionId} groupId={chat.id} ownPhone={context.ownPhone} pictures={pictures} onOpenChat={onOpenChat} />
          : <CommonGroups sessionId={sessionId} chatId={chat.id} phone={phone} pictures={pictures} onOpenChat={onOpenChat} />}
        <Divider />
        <Row icon="Tag" label="Add to list" onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setListMenu({ x: box.left + 16, y: box.bottom }) }} />
        <Row icon="Download" label="Export chat" onClick={exportChat} />
        {!chat.isGroup && <BlockRow sessionId={sessionId} chat={chat} confirming={confirm === 'block'} onConfirm={(open) => setConfirm(open ? 'block' : null)} />}
        <Row icon="Trash2" label="Delete chat" danger onClick={() => setConfirm('delete')} />
      </div>
    </motion.aside>
    {mediaOpen && <MediaLibrary sessionId={sessionId} chats={[chat]} tags={tags.tags} initialTags={[]} pictures={pictures}
      ownName={context.ownName} ownPhone={context.ownPhone} onClose={() => setMediaOpen(false)} />}
    {listMenu && <ChatTagMenu chat={chat} x={listMenu.x} y={listMenu.y} tags={tags} onClose={() => setListMenu(null)} />}
    {confirm === 'delete' && <DeleteChat sessionId={sessionId} chat={chat} onClose={() => setConfirm(null)} onDeleted={onDeleted} />}
  </>
}

const Divider = () => <hr className="my-1 border-line" />

function Row({ icon, label, detail, danger, expanded, onClick, children }: {
  icon: string; label: string; detail?: string; danger?: boolean; expanded?: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; children?: ReactNode
}) {
  return (
    <button type="button" onClick={onClick} aria-expanded={expanded}
      className={cn('flex w-full items-center gap-4 px-5 py-3 text-left text-sm transition-colors hover:bg-ink-900/[0.04] focus-visible:focus-ring',
        danger ? 'text-crimson' : 'text-ink')}>
      <Icon name={icon} size={18} className={danger ? undefined : 'text-muted'} />
      <span className="flex-1">{label}</span>
      {children}
      {detail && <span className="text-xs text-muted">{detail}</span>}
    </button>
  )
}

function GroupDescription({ sessionId, groupId }: { sessionId: string; groupId: string }) {
  const info = useQuery({ queryKey: ['whatsapp', sessionId, 'group', groupId], queryFn: () => whatsappApi.groupInfo(sessionId, groupId), staleTime: ROSTER_STALE_MS })
  if (!info.data) return null
  return <>
    <p className="text-sm text-muted">Group · {info.data.participants.length} members</p>
    {info.data.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink-700">{info.data.description}</p>}
  </>
}

function MuteRow({ sessionId, chatId }: { sessionId: string; chatId: string }) {
  const toast = useToast()
  const [muted, setMuted] = useState(() => (readMuted(sessionId)[chatId] ?? 0) > Date.now())
  const mute = useMutation({
    mutationFn: (on: boolean) => whatsappApi.mute(sessionId, chatId, on ? MUTE_FOREVER : null),
    onSuccess: (_, on) => {
      const { [chatId]: _old, ...rest } = readMuted(sessionId)
      localStorage.setItem(muteKey(sessionId), JSON.stringify(on ? { ...rest, [chatId]: MUTE_FOREVER } : rest))
      setMuted(on)
      toast(on ? 'Notifications muted' : 'Notifications unmuted')
    },
    onError: (error) => toast(`Could not change notifications: ${error.message}`, undefined, 'error'),
  })
  return (
    <div className="flex items-center gap-4 px-5 py-3 text-sm text-ink">
      <Icon name="BellOff" size={18} className="text-muted" />
      <span className="flex-1">Mute notifications</span>
      <button type="button" role="switch" aria-checked={muted} aria-label="Mute notifications" disabled={mute.isPending} onClick={() => mute.mutate(!muted)}
        className={cn('relative h-5 w-9 rounded-full transition-colors focus-visible:focus-ring disabled:opacity-60', muted ? 'bg-emerald-600' : 'bg-ink-900/20')}>
        <span className={cn('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', muted && 'translate-x-4')} />
      </button>
    </div>
  )
}

function GroupLink({ id, name, subtitle, photoUrl, isGroup, onOpenChat }: {
  id: string; name: string; subtitle?: string; photoUrl?: string | null; isGroup: boolean; onOpenChat: (chat: WhatsAppChat) => void
}) {
  return (
    <li>
      <button type="button" onClick={() => onOpenChat({ id, name, isGroup, unreadCount: 0, timestamp: 0 })}
        className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-ink-900/[0.04] focus-visible:focus-ring">
        <Avatar person={{ name, photoUrl }} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{name}</span>
          {subtitle && <span className="block truncate text-xs text-muted">{subtitle}</span>}
        </span>
      </button>
    </li>
  )
}

function CommonGroups({ sessionId, chatId, phone, pictures, onOpenChat }: {
  sessionId: string; chatId: string; phone: string | null; pictures: Record<string, string | null>; onOpenChat: (chat: WhatsAppChat) => void
}) {
  const rosters = useQuery({ queryKey: ['whatsapp', sessionId, 'groupRosters'], queryFn: () => whatsappApi.groupRosters(sessionId), staleTime: ROSTER_STALE_MS })
  const common = (rosters.data ?? []).filter((group) => hasMember(group, chatId, phone))
  return (
    <section aria-label="Groups in common">
      <h3 className="px-5 pb-1 pt-3 text-xs font-medium text-muted">{rosters.isSuccess ? `${common.length} group${common.length === 1 ? '' : 's'} in common` : 'Groups in common'}</h3>
      {rosters.isPending && <p className="flex items-center gap-2 px-5 py-2 text-sm text-muted"><Icon name="Loader" size={14} className="animate-spin" />Finding shared groups…</p>}
      {rosters.isError && <p role="alert" className="px-5 py-2 text-sm text-crimson">Could not load groups: {rosters.error.message} <button type="button" className="underline" onClick={() => void rosters.refetch()}>Retry</button></p>}
      <ul>
        {common.map((group) => <GroupLink key={group.id} id={group.id} name={group.name} isGroup photoUrl={pictures[group.id]} onOpenChat={onOpenChat}
          subtitle={group.participants.map((member) => member.name || formatPhone(member.number)).join(', ')} />)}
      </ul>
    </section>
  )
}

function Members({ sessionId, groupId, ownPhone, pictures, onOpenChat }: {
  sessionId: string; groupId: string; ownPhone: string | null; pictures: Record<string, string | null>; onOpenChat: (chat: WhatsAppChat) => void
}) {
  const info = useQuery({ queryKey: ['whatsapp', sessionId, 'group', groupId], queryFn: () => whatsappApi.groupInfo(sessionId, groupId), staleTime: ROSTER_STALE_MS })
  const members = [...(info.data?.participants ?? [])].sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin))
  return (
    <section aria-label="Members">
      <h3 className="px-5 pb-1 pt-3 text-xs font-medium text-muted">{info.data ? `${members.length} members` : 'Members'}</h3>
      {info.isPending && <p className="flex items-center gap-2 px-5 py-2 text-sm text-muted"><Icon name="Loader" size={14} className="animate-spin" />Loading members…</p>}
      {info.isError && <p role="alert" className="px-5 py-2 text-sm text-crimson">Could not load members: {info.error.message}</p>}
      <ul>
        {members.map((member) => member.number === ownPhone
          ? <li key={member.id} className="px-5 py-2.5 text-sm font-medium text-ink">You{member.isAdmin && <span className="ml-2 text-xs text-emerald-700">Group admin</span>}</li>
          : <GroupLink key={member.id} id={member.id} name={member.name || formatPhone(member.number)} isGroup={false} photoUrl={pictures[member.id]} onOpenChat={onOpenChat}
              subtitle={member.isAdmin ? 'Group admin' : undefined} />)}
      </ul>
    </section>
  )
}

function BlockRow({ sessionId, chat, confirming, onConfirm }: { sessionId: string; chat: WhatsAppChat; confirming: boolean; onConfirm: (open: boolean) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const key = ['whatsapp', sessionId, 'contact', chat.id]
  const contact = useQuery({ queryKey: key, queryFn: () => whatsappApi.contact(sessionId, chat.id), retry: false })
  const blocked = !!contact.data?.isBlocked
  const block = useMutation({
    mutationFn: () => whatsappApi.block(sessionId, chat.id, !blocked),
    onSuccess: () => { qc.setQueryData(key, { ...contact.data, isBlocked: !blocked }); onConfirm(false); toast(blocked ? `${nameOf(chat)} unblocked` : `${nameOf(chat)} blocked`) },
    onError: (error) => toast(`Could not ${blocked ? 'unblock' : 'block'}: ${error.message}`, undefined, 'error'),
  })
  const verb = blocked ? 'Unblock' : 'Block'
  return <>
    <Row icon="Ban" label={`${verb} ${nameOf(chat)}`} danger onClick={() => onConfirm(true)} />
    <Dialog open={confirming} onClose={() => onConfirm(false)} title={`${verb} ${nameOf(chat)}?`}
      description={blocked ? 'They will be able to call you and send you messages again.' : 'Blocked contacts can no longer call you or send you messages.'}
      footer={<><Button onClick={() => onConfirm(false)}>Cancel</Button><Button variant="danger" disabled={block.isPending} onClick={() => block.mutate()}>{verb}</Button></>}>
      {null}
    </Dialog>
  </>
}

function DeleteChat({ sessionId, chat, onClose, onDeleted }: { sessionId: string; chat: WhatsAppChat; onClose: () => void; onDeleted: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const remove = useMutation({
    mutationFn: () => whatsappApi.deleteChat(sessionId, chat.id),
    onSuccess: () => {
      qc.setQueryData<WhatsAppChat[]>(['whatsapp', sessionId, 'chats'], (chats) => chats?.filter((item) => item.id !== chat.id))
      toast('Chat deleted')
      onDeleted()
    },
    onError: (error) => toast(`Could not delete chat: ${error.message}`, undefined, 'error'),
  })
  return (
    <Dialog open onClose={onClose} title={`Delete chat with ${nameOf(chat)}?`} description="The chat is deleted on your phone too. This cannot be undone."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete chat</Button></>}>
      {null}
    </Dialog>
  )
}
