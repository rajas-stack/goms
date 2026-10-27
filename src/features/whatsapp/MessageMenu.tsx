import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { OWNED_SHEET_LABELS, isOwnedSheet } from '@goms/domain'
import { repository } from '@/data/repository'
import { bytesToBase64 } from '@/data/in-memory/makerDocuments'
import { useAuthUser } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import { GridContextMenu, type MenuEntry } from '@/modules/bid-tracker/components/GridContextMenu'
import { isBidTrackerEnabled } from '@/modules/bid-tracker/enabled'
import type { BidGridRow } from '@/lib/types'
import { chatPhone, formatPhone, KEEP_FILE_BYTES, MEDIA_TYPES, PIN_DURATIONS, mentionIdsOf, nameMentions, whatsappApi, whoIs, type WhatsAppChat, type WhatsAppMessage } from './api'
import { parseVCards, type ChatFile } from './Attachments'
import { applyMessage, type PushedMessage } from './events'
import { saveStar, starredKey } from './starredMessages'

export const QUICK_REACTIONS =['👍', '❤️', '😂', '😮', '😢', '🙏']
const MORE_REACTIONS = [
  ...QUICK_REACTIONS, '😀', '😁', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤔', '🙄', '😴', '😅', '😇', '🤝', '👏', '🙌', '💪', '👌',
  '✌️', '🤞', '🔥', '🎉', '✅', '❌', '💯', '⭐', '💡', '📌', '📎', '📅', '⏰', '💰', '🚀', '👀', '🙂', '😡',
]

export type MessageDialog = 'react' | 'forward' | 'pin' | 'delete' | 'opportunity'

/** What the menu needs to know about the conversation it was opened in. */
export interface ChatContext { sessionId: string; chat: WhatsAppChat; chats: WhatsAppChat[]; ownName: string; ownPhone: string | null }

const phoneOf = (waId: string) => waId.split('@')[0]

/** The text Copy puts on the clipboard, or null when the message has none. */
export function copyableText(message: WhatsAppMessage, file?: ChatFile): string | null {
  if (message.type === 'contact') {
    const cards = parseVCards(message.body)
    return cards.length ? cards.map((card) => [card.name, ...card.phones].join('\n')).join('\n\n') : null
  }
  if (message.type === 'location' && message.location) {
    const { latitude, longitude } = message.location
    return `${latitude},${longitude} https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
  }
  if (message.type === 'revoked') return null
  return message.body || (MEDIA_TYPES.has(message.type) ? file?.filename || null : null)
}

/** The actions behind the menu, each confirming itself with a toast. Local flags (reaction, star, pin) are written into the
 *  chat's cached history, since WhatsApp's history does not report them back. */
export function useMessageActions({ sessionId, chat, chats, ownName, ownPhone }: ChatContext) {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const { user } = useAuthUser()
  const historyKey = ['whatsapp', sessionId, 'history', chat.id]
  const patch = (messageId: string, change: Partial<WhatsAppMessage> | null) =>
    qc.setQueryData<WhatsAppMessage[]>(historyKey, (list) => list && (change
      ? list.map((message) => (message.id === messageId ? { ...message, ...change } : message))
      : list.filter((message) => message.id !== messageId)))
  const fail = (what: string) => (error: unknown) => toast(`Could not ${what}: ${(error as Error).message}`, undefined, 'error')
  const chatLabel = (target: WhatsAppChat) => target.name || chatPhone(target.id)

  const pin = (message: WhatsAppMessage, seconds: number) =>
    whatsappApi.pin(sessionId, chat.id, message.id, seconds).then(() => {
      patch(message.id, { pinned: true })
      toast(`Pinned for ${PIN_DURATIONS.find((option) => option.seconds === seconds)?.label ?? 'a while'}`, { label: 'Undo', onClick: () => void unpin(message) })
    }, fail('pin the message'))
  const unpin = (message: WhatsAppMessage) =>
    whatsappApi.unpin(sessionId, chat.id, message.id).then(() => { patch(message.id, { pinned: false }); toast('Unpinned') }, fail('unpin the message'))
  const star = (message: WhatsAppMessage, on: boolean): Promise<void> =>
    whatsappApi.star(sessionId, chat.id, message.id, on).then(() => {
      patch(message.id, { starred: on })
      try { qc.setQueryData(starredKey(sessionId), saveStar(sessionId, chat, message, on)) }
      catch { toast('The star was updated on WhatsApp, but could not be saved in this browser.', undefined, 'error') }
      toast(on ? 'Starred' : 'Unstarred', { label: 'Undo', onClick: () => void star(message, !on) })
    }, fail(on ? 'star the message' : 'remove the star'))

  return {
    copy: async (message: WhatsAppMessage, file?: ChatFile) => {
      const text = copyableText(message, file)
      if (!text) return
      try { await navigator.clipboard.writeText(text); toast('Copied to clipboard') } catch { toast('Could not copy: the browser blocked the clipboard.', undefined, 'error') }
    },
    react: (message: WhatsAppMessage, emoji: string) => {
      const next = message.myReaction === emoji ? '' : emoji // the same emoji again takes it back, as in WhatsApp
      return whatsappApi.react(sessionId, chat.id, message.id, next)
        .then(() => { patch(message.id, { myReaction: next || undefined }); toast(next ? `Reacted ${next}` : 'Reaction removed') }, fail('react'))
    },
    forward: (message: WhatsAppMessage, target: WhatsAppChat) =>
      whatsappApi.forward(sessionId, chat.id, target.id, message.id).then(({ messageId, timestamp }) => {
        const copy: PushedMessage = { ...message, id: messageId, chatId: target.id, timestamp, fromMe: true, myReaction: undefined, starred: undefined, pinned: undefined }
        qc.setQueryData<WhatsAppChat[]>(['whatsapp', sessionId, 'chats'], (list) => list && applyMessage(list, copy, target.id))
        toast(`Forwarded to ${chatLabel(target)}`, { label: 'Open', onClick: () => navigate(`/whatsapp?chat=${encodeURIComponent(target.id)}`) })
      }, fail('forward the message')),
    pin, unpin, star,
    remove: (message: WhatsAppMessage, forEveryone: boolean) =>
      whatsappApi.remove(sessionId, chat.id, message.id, forEveryone).then(() => {
        patch(message.id, forEveryone ? { type: 'revoked', body: '', media: undefined } : null)
        try { qc.setQueryData(starredKey(sessionId), saveStar(sessionId, chat, message, false)) } catch { /* The phone deletion has already succeeded. */ }
        toast(forEveryone ? 'Deleted for everyone' : 'Deleted for you')
      }, fail('delete the message')),
    /** Files the message, as it is now, to an opportunity's Communication tab. */
    fileTo: async (message: WhatsAppMessage, row: BidGridRow, file?: ChatFile) => {
      // Only …@c.us ids are phone numbers; a …@lid author is WhatsApp's privacy id.
      const phoneId = (id?: string) => (id?.endsWith('@c.us') ? phoneOf(id) : null)
      let senderPhone = message.fromMe ? ownPhone : message.senderPhone || phoneId(message.author) || (chat.isGroup ? null : phoneId(chat.id))
      let contactName = message.contact?.name || message.contact?.pushName
      try {
        // A group sender WhatsApp named only by a privacy id: ask the gateway who it is.
        if (!message.fromMe && chat.isGroup && message.author && (!contactName || !senderPhone)) {
          const who = await whoIs(sessionId, message.author)
          contactName ||= who.name ?? undefined
          senderPhone ||= who.phone
        }
        const text = copyableText(message, file) ?? ''
        const { created } = await repository.addWhatsAppLink({
          opportunityId: row.opportunityId, bidId: row.id, chatId: chat.id, chatName: chatLabel(chat), messageId: message.id, fromMe: message.fromMe,
          senderName: message.fromMe ? ownName : chat.isGroup ? (contactName || (senderPhone ? formatPhone(senderPhone) : 'Group member')) : chatLabel(chat),
          senderPhone, type: message.type, body: await nameMentions(sessionId, text, mentionIdsOf(message)),
          filename: file?.filename ?? null, sentAt: new Date(message.timestamp * 1000).toISOString(),
          // The person who filed it: their GOMS sign-in, else the owner of the WhatsApp linked on this computer.
          addedBy: user?.displayName || user?.email || ownName,
          file: file?.blob && file.blob.size <= KEEP_FILE_BYTES
            ? { mimetype: file.mimetype, base64: bytesToBase64(new Uint8Array(await file.blob.arrayBuffer())) } : null,
        })
        void qc.invalidateQueries({ queryKey: ['whatsappLinks'] })
        const open = isBidTrackerEnabled() ? { label: 'Open', onClick: () => navigate(`/live-bids/bid/${row.id}?tab=communication`) } : undefined
        toast(created ? `Added to ${row.opportunityName || 'the opportunity'}` : `Already in ${row.opportunityName || 'that opportunity'}`, open)
      } catch (error) { fail('add it to the opportunity')(error) }
    },
  }
}

export type MessageActions = ReturnType<typeof useMessageActions>

/** WhatsApp's message menu, on right-click: quick reactions, then the actions. */
export function MessageMenu({ message, file, x, y, actions, onReply, onDialog, onClose }: {
  message: WhatsAppMessage; file?: ChatFile; x: number; y: number; actions: MessageActions
  onReply: () => void; onDialog: (dialog: MessageDialog) => void; onClose: () => void
}) {
  const gone = message.type === 'revoked'
  const groups: MenuEntry[][] = [
    [
      { label: 'Reply', icon: 'Reply', onSelect: onReply, disabled: gone },
      { label: 'Copy', icon: 'Copy', onSelect: () => void actions.copy(message, file), disabled: !copyableText(message, file) },
      { label: 'React', icon: 'Sparkles', onSelect: () => onDialog('react'), disabled: gone },
      { label: 'Forward', icon: 'Forward', onSelect: () => onDialog('forward'), disabled: gone },
      message.pinned
        ? { label: 'Unpin', icon: 'PinOff', onSelect: () => void actions.unpin(message) }
        : { label: 'Pin', icon: 'Pin', onSelect: () => onDialog('pin'), disabled: gone },
      { label: message.starred ? 'Unstar' : 'Star', icon: 'Star', onSelect: () => void actions.star(message, !message.starred), disabled: gone },
    ],
    [{ label: 'Add to opportunity', icon: 'Briefcase', onSelect: () => onDialog('opportunity'), disabled: gone }],
    [{ label: 'Delete', icon: 'Trash2', onSelect: () => onDialog('delete'), danger: true }],
  ]
  const header = gone ? null : (
    <div className="mb-1 flex items-center justify-between gap-1 border-b border-line px-1 pb-1.5 pt-0.5" role="group" aria-label="Quick reactions">
      {QUICK_REACTIONS.map((emoji) => (
        <button key={emoji} type="button" aria-label={`React ${emoji}`} aria-pressed={message.myReaction === emoji}
          onClick={() => { onClose(); void actions.react(message, emoji) }}
          className={cn('flex h-9 w-9 items-center justify-center rounded-full text-xl transition hover:scale-125 hover:bg-ink-900/[0.06] motion-reduce:transform-none',
            message.myReaction === emoji && 'bg-emerald-600/15')}>
          {emoji}
        </button>
      ))}
    </div>
  )
  return <GridContextMenu x={x} y={y} title="Message options" header={header} groups={groups} onClose={onClose} />
}

/** The dialog a menu action opened. */
export function MessageDialogs({ dialog, message, file, context, actions, onClose }: {
  dialog: MessageDialog; message: WhatsAppMessage; file?: ChatFile; context: ChatContext; actions: MessageActions; onClose: () => void
}) {
  const run = (work: Promise<unknown>) => { onClose(); void work }
  if (dialog === 'react') {
    return (
      <Dialog open onClose={onClose} title="React to message" size="md">
        <div className="grid grid-cols-8 gap-1" role="group" aria-label="Reactions">
          {MORE_REACTIONS.map((emoji) => (
            <button key={emoji} type="button" aria-label={`React ${emoji}`} aria-pressed={message.myReaction === emoji} onClick={() => run(actions.react(message, emoji))}
              className={cn('flex h-10 items-center justify-center rounded-lg text-2xl transition hover:scale-110 hover:bg-ink-900/[0.06] motion-reduce:transform-none',
                message.myReaction === emoji && 'bg-emerald-600/15')}>{emoji}</button>
          ))}
        </div>
        {message.myReaction && <Button className="mt-3" variant="ghost" onClick={() => run(actions.react(message, message.myReaction!))}>Remove my reaction {message.myReaction}</Button>}
      </Dialog>
    )
  }
  if (dialog === 'pin') return <PinDialog onPin={(seconds) => run(actions.pin(message, seconds))} onClose={onClose} />
  if (dialog === 'delete') {
    return (
      <Dialog open onClose={onClose} title="Delete message?" size="md"
        footer={<>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={() => run(actions.remove(message, false))}>Delete for me</Button>
          {message.fromMe && message.type !== 'revoked' && <Button variant="danger" onClick={() => run(actions.remove(message, true))}>Delete for everyone</Button>}
        </>}>
        <p className="text-sm text-muted">{message.fromMe
          ? '"Delete for everyone" removes it from the chat for all members; WhatsApp only allows this for a limited time after sending.'
          : 'This removes the message from your WhatsApp only.'}</p>
      </Dialog>
    )
  }
  if (dialog === 'forward') return <ForwardDialog chats={context.chats.filter((chat) => chat.id !== context.chat.id)} onPick={(target) => run(actions.forward(message, target))} onClose={onClose} />
  return <OpportunityPicker preview={copyableText(message, file) ?? message.type} onPick={(row) => run(actions.fileTo(message, row, file))} onClose={onClose} />
}

function PinDialog({ onPin, onClose }: { onPin: (seconds: number) => void; onClose: () => void }) {
  const [seconds, setSeconds] = useState<number>(PIN_DURATIONS[1].seconds)
  return (
    <Dialog open onClose={onClose} title="Choose how long your pin lasts" size="md"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onPin(seconds)}>Pin</Button></>}>
      <div className="space-y-1" role="radiogroup" aria-label="Pin duration">
        {PIN_DURATIONS.map((option) => (
          <label key={option.seconds} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-ink-900/[0.04]">
            <input type="radio" name="pin-duration" checked={seconds === option.seconds} onChange={() => setSeconds(option.seconds)} className="accent-emerald-600" />
            <span className="text-sm text-ink">{option.label}</span>
          </label>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-muted">You can unpin at any time.</p>
    </Dialog>
  )
}

function ForwardDialog({ chats, onPick, onClose }: { chats: WhatsAppChat[]; onPick: (chat: WhatsAppChat) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const typed = query.trim().toLowerCase()
  const shown = chats.filter((chat) => !typed || `${chat.name} ${phoneOf(chat.id)}`.toLowerCase().includes(typed))
  return (
    <Dialog open onClose={onClose} title="Forward message to" size="md">
      <Input autoFocus aria-label="Search chats" placeholder="Search chats" value={query} onChange={(event) => setQuery(event.target.value)} />
      <ul className="mt-2 max-h-80 space-y-0.5 overflow-y-auto" aria-label="Chats">
        {shown.length === 0 && <li className="p-3 text-sm text-muted">No chat matches.</li>}
        {shown.map((chat) => (
          <li key={chat.id}>
            <button type="button" onClick={() => onPick(chat)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-ink-900/[0.05] focus-visible:focus-ring">
              <Icon name={chat.isGroup ? 'Users' : 'User'} size={15} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{chat.name || chatPhone(chat.id)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}

const PICKER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'bidTracker', label: 'Live Bids' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'campaign', label: 'Campaign' },
] as const
type PickerTab = (typeof PICKER_TABS)[number]['key']
const inTab = (row: BidGridRow, tab: PickerTab) => tab === 'all' || (tab === 'pipeline' ? row.sheet.startsWith('pipeline') : row.sheet === tab)

/** Picks the opportunity a message is filed to, from every Opportunity sheet (Master = All). */
export function OpportunityPicker({ preview, onPick, onClose }: { preview: string; onPick: (row: BidGridRow) => void; onClose: () => void }) {
  const rows = useQuery({ queryKey: ['bidsForGrid', 'whatsapp-picker'], queryFn: () => repository.listBidsForGrid() })
  const [tab, setTab] = useState<PickerTab>('all')
  const [query, setQuery] = useState('')
  const typed = query.trim().toLowerCase()
  const shown = useMemo(() => (rows.data ?? [])
    .filter((row) => inTab(row, tab))
    .filter((row) => !typed || [row.opportunityName, row.opportunityCode, row.bidCode, row.gemTenderId, row.departmentName, row.vertical]
      .some((value) => value?.toLowerCase().includes(typed)))
    .sort((a, b) => (b.submissionDate ?? '').localeCompare(a.submissionDate ?? '')), [rows.data, tab, typed])
  return (
    <Dialog open onClose={onClose} title="Add to opportunity" description="The message goes into the opportunity's Communication tab, with its sender, date and time." size="lg">
      <p className="mb-3 line-clamp-2 rounded-lg bg-ink-900/[0.05] px-3 py-2 text-[13px] text-ink">{preview}</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-ink-900/[0.05] p-0.5" role="tablist" aria-label="Opportunity sheet">
          {PICKER_TABS.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)}
              className={cn('rounded-md px-3 py-1.5 text-[13px] font-medium transition', tab === item.key ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink')}>
              {item.label} <span className="tabular-nums opacity-60">{(rows.data ?? []).filter((row) => inTab(row, item.key)).length}</span>
            </button>
          ))}
        </div>
        <Input autoFocus aria-label="Search opportunities" placeholder="Search by name, code, tender ID, department" value={query}
          onChange={(event) => setQuery(event.target.value)} className="min-w-56 flex-1" />
      </div>
      <ul className="mt-3 max-h-96 space-y-1 overflow-y-auto" aria-label="Opportunities">
        {rows.isPending && <li className="flex items-center gap-2 p-3 text-sm text-muted"><Icon name="Loader" className="animate-spin" />Loading opportunities…</li>}
        {rows.isError && <li role="alert" className="p-3 text-sm text-crimson">Could not load opportunities: {rows.error.message}</li>}
        {rows.isSuccess && shown.length === 0 && <li className="p-3 text-sm text-muted">No opportunity matches.</li>}
        {shown.map((row) => (
          <li key={row.id}>
            <button type="button" onClick={() => onPick(row)}
              className="flex w-full items-start gap-3 rounded-lg border border-line/70 bg-white px-3 py-2 text-left transition hover:border-emerald-600/50 hover:shadow-sm focus-visible:focus-ring">
              <Icon name="Briefcase" size={16} className="mt-0.5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{row.opportunityName || 'Untitled opportunity'}</span>
                <span className="block truncate text-[12px] text-muted">
                  {[row.opportunityCode || row.bidCode, isOwnedSheet(row.sheet) ? OWNED_SHEET_LABELS[row.sheet] : row.sheet, row.departmentName, row.gemTenderId].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
