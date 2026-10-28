import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus, MailCheck, SquareCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { Menu, MenuDivider, MenuItem } from '@/components/ui/Menu'
import { useToast } from '@/components/ui/Toast'
import { chatPhone, formatPhone, whatsappApi, type WhatsAppChat } from './api'
import { readStarred, starredKey } from './starredMessages'

const label = (chat: WhatsAppChat) => chat.name || chatPhone(chat.id)

/** Clear only successfully acknowledged chats; a failed request must leave its unread badge intact. */
export function useReadChats(sessionId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => whatsappApi.markRead(sessionId, id)))
      const done = new Set(ids.filter((_, index) => results[index].status === 'fulfilled'))
      qc.setQueryData<WhatsAppChat[]>(['whatsapp', sessionId, 'chats'], (chats) => chats?.map((chat) => done.has(chat.id) ? { ...chat, unreadCount: 0 } : chat))
      const failed = results.length - done.size
      if (failed) toast(`${failed} ${failed === 1 ? 'chat could' : 'chats could'} not be marked as read. Please retry.`, undefined, 'error')
      else toast(ids.length ? 'Marked as read' : 'All chats are already read')
    },
  })
}

export function ChatActions({ sessionId, chats, onOpen, onSelect, onMarkAllRead, markingRead, onLock, onLogout }: {
  sessionId: string; chats: WhatsAppChat[]; onOpen: (chat: WhatsAppChat) => void; onSelect: () => void
  onMarkAllRead: () => void; markingRead: boolean; onLock: () => void; onLogout: () => void
}) {
  const [dialog, setDialog] = useState<'chat' | 'group' | 'starred' | null>(null)
  return <>
    <div className="flex items-center gap-2">
      <Menu className="w-[220px] origin-top-right rounded-[20px] px-1.5 py-2" trigger={({ open, toggle }) => (
        <button type="button" aria-label="Chat options" aria-haspopup="menu" aria-expanded={open} onClick={toggle}
          className="flex h-10 w-10 items-center justify-center rounded-full text-ink transition-colors hover:bg-ink-900/[0.06] focus-visible:focus-ring active:scale-[.97]">
          <Icon name="EllipsisVertical" size={22} />
        </button>
      )}>
        {(close) => {
          const pick = (action: () => void) => () => { close(); action() }
          return <>
            <MenuItem className="min-h-11 lg:min-h-11 text-sm" icon={<Icon name="Users" size={20} />} onClick={pick(() => setDialog('group'))}>New group</MenuItem>
            <MenuItem className="min-h-11 lg:min-h-11 text-sm" icon={<Icon name="Star" size={20} />} onClick={pick(() => setDialog('starred'))}>Starred messages</MenuItem>
            <MenuItem className="min-h-11 lg:min-h-11 text-sm" icon={<SquareCheck size={20} aria-hidden />} onClick={pick(onSelect)}>Select chats</MenuItem>
            <MenuItem className="min-h-11 lg:min-h-11 text-sm" icon={<MailCheck size={20} aria-hidden />} disabled={markingRead} onClick={pick(onMarkAllRead)}>Mark all as read</MenuItem>
            <MenuDivider />
            <MenuItem className="min-h-11 lg:min-h-11 text-sm" icon={<Icon name="Lock" size={20} />} onClick={pick(onLock)}>App lock</MenuItem>
            <MenuItem className="min-h-11 lg:min-h-11 text-sm" icon={<Icon name="LogOut" size={20} />} onClick={pick(onLogout)}>Log out</MenuItem>
          </>
        }}
      </Menu>
      <button type="button" aria-label="New chat" title="New chat" onClick={() => setDialog('chat')}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-slate-950 transition-colors hover:bg-emerald-400 focus-visible:focus-ring active:scale-[.97]">
        <MessageSquarePlus size={22} strokeWidth={2.2} aria-hidden />
      </button>
    </div>
    {(dialog === 'chat' || dialog === 'group') && <NewConversation key={dialog} kind={dialog} sessionId={sessionId} chats={chats}
      onOpen={(chat) => { setDialog(null); onOpen(chat) }} onClose={() => setDialog(null)} />}
    {dialog === 'starred' && <StarredMessages sessionId={sessionId} onClose={() => setDialog(null)} onOpen={(chat) => { setDialog(null); onOpen(chat) }} />}
  </>
}

function NewConversation({ kind, sessionId, chats, onOpen, onClose }: {
  kind: 'chat' | 'group'; sessionId: string; chats: WhatsAppChat[]; onOpen: (chat: WhatsAppChat) => void; onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [groupName, setGroupName] = useState('')
  const [participants, setParticipants] = useState<Set<string>>(new Set())
  const contacts = useQuery({ queryKey: ['whatsapp', sessionId, 'contacts'], queryFn: () => whatsappApi.contacts(sessionId), staleTime: 60_000, retry: false })
  const choices = useMemo(() => {
    const found = new Map(chats.filter((chat) => !chat.isGroup).map((chat) => [chat.id, chat]))
    for (const contact of contacts.data ?? []) {
      if (contact.isGroup || !/@(?:c\.us|lid)$/.test(contact.id)) continue
      const existing = found.get(contact.id)
      found.set(contact.id, existing ?? { id: contact.id, name: contact.name || contact.pushName || (contact.number ? formatPhone(contact.number) : ''), isGroup: false, unreadCount: 0, timestamp: 0 })
    }
    return [...found.values()].sort((a, b) => label(a).localeCompare(label(b)))
  }, [contacts.data, chats])
  const term = search.trim().toLowerCase()
  const shown = choices.filter((chat) => `${label(chat)} ${chat.id.split('@')[0]}`.toLowerCase().includes(term))
  const number = search.replace(/[\s()+.-]/g, '')
  const phoneSearch = /^\d{7,15}$/.test(number)
  const lookup = useMutation({ mutationFn: async () => {
    const result = await whatsappApi.checkNumber(sessionId, number)
    if (!result.exists || !result.whatsappId) throw new Error('This number is not registered on WhatsApp.')
    const chat = choices.find((item) => item.id === result.whatsappId) ?? { id: result.whatsappId, name: formatPhone(number), isGroup: false, unreadCount: 0, timestamp: 0 }
    if (kind === 'chat') onOpen(chat)
    else { setExtra((list) => list.some((item) => item.id === chat.id) ? list : [...list, chat]); setParticipants((old) => new Set(old).add(chat.id)); setSearch('') }
  } })
  const [extra, setExtra] = useState<WhatsAppChat[]>([])
  const create = useMutation({ mutationFn: async () => {
    const group = await whatsappApi.createGroup(sessionId, groupName.trim(), [...participants])
    onOpen({ id: group.id, name: group.name || groupName.trim(), isGroup: true, unreadCount: 0, timestamp: Math.floor(Date.now() / 1000) })
  } })
  const candidates = [...shown, ...extra.filter((chat) => !choices.some((item) => item.id === chat.id) && `${label(chat)} ${chat.id}`.toLowerCase().includes(term))]
  return <Dialog open onClose={onClose} title={kind === 'chat' ? 'New chat' : 'New group'}
    description={kind === 'chat' ? 'Choose a contact or enter a phone number with its country code. Opening a chat does not send a message.' : 'Name your group and choose its members.'}
    footer={kind === 'group' && <><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!groupName.trim() || !participants.size || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : `Create group${participants.size ? ` (${participants.size})` : ''}`}</Button></>}>
    <div className="space-y-4">
      {kind === 'group' && <label className="block space-y-1 text-sm font-medium">Group name<Input value={groupName} maxLength={100} onChange={(event) => setGroupName(event.target.value)} /></label>}
      <label className="block space-y-1 text-sm font-medium">Search contacts or phone number<Input autoFocus value={search} onChange={(event) => { setSearch(event.target.value); lookup.reset() }} placeholder="Name or +91…" /></label>
      {phoneSearch && <Button disabled={lookup.isPending} onClick={() => lookup.mutate()}><Icon name={lookup.isPending ? 'Loader' : 'UserPlus'} />{kind === 'chat' ? 'Chat with' : 'Add'} +{number}</Button>}
      {lookup.error && <p role="alert" className="text-sm text-crimson">{lookup.error.message}</p>}
      {create.error && <p role="alert" className="text-sm text-crimson">{create.error.message}{/not supported|not implemented/i.test(create.error.message) && ' You can create the group on your phone and refresh this list.'}</p>}
      {contacts.isPending && <p className="text-sm text-muted">Loading contacts…</p>}
      {contacts.error && <p role="alert" className="text-sm text-crimson">Could not load contacts: {contacts.error.message} <button onClick={() => void contacts.refetch()} className="underline">Retry</button></p>}
      <ul aria-label={kind === 'group' ? 'Group members' : 'Contacts'} className="max-h-72 space-y-1 overflow-y-auto">
        {candidates.map((chat) => <li key={chat.id}>
          {kind === 'group'
            ? <label className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-ink-900/[0.04]"><input type="checkbox" checked={participants.has(chat.id)} onChange={() => setParticipants((old) => { const next = new Set(old); if (next.has(chat.id)) next.delete(chat.id); else next.add(chat.id); return next })} /><ContactLabel chat={chat} /></label>
            : <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-ink-900/[0.04] focus-visible:focus-ring" onClick={() => onOpen(chat)}><Icon name="User" size={20} /><ContactLabel chat={chat} /></button>}
        </li>)}
        {!contacts.isPending && !candidates.length && <li className="p-3 text-sm text-muted">No matching contacts. Enter a phone number with its country code.</li>}
      </ul>
    </div>
  </Dialog>
}

function ContactLabel({ chat }: { chat: WhatsAppChat }) {
  return <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{label(chat)}</span>{!chat.id.endsWith('@lid') && <span className="block text-xs text-muted">{chatPhone(chat.id)}</span>}</span>
}

function StarredMessages({ sessionId, onClose, onOpen }: { sessionId: string; onClose: () => void; onOpen: (chat: WhatsAppChat) => void }) {
  const saved = useQuery({ queryKey: starredKey(sessionId), queryFn: () => readStarred(sessionId), staleTime: Infinity })
  return <Dialog open onClose={onClose} title="Starred messages" description="Messages starred in GOMS are saved in this browser. Stars made only on your phone are not listed here.">
    <ul className="space-y-2">
      {(saved.data ?? []).map(({ chat, message }) => <li key={`${chat.id}/${message.id}`}><button type="button" onClick={() => onOpen(chat)} className="w-full rounded-xl border border-line p-3 text-left hover:bg-ink-900/[0.04] focus-visible:focus-ring">
        <span className="flex items-center gap-2 text-sm font-semibold"><Icon name="Star" />{label(chat)}</span>
        <span className="mt-1 block whitespace-pre-wrap break-words text-sm">{message.body || message.type}</span>
        <span className="mt-1 block text-xs text-muted">{new Date(message.timestamp * 1000).toLocaleString()}</span>
      </button></li>)}
      {!saved.data?.length && <li className="py-6 text-center text-sm text-muted">No starred messages yet. Open a message’s menu and choose Star.</li>}
    </ul>
  </Dialog>
}
