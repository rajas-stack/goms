import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useMutationState, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useSearchParams } from 'react-router-dom'
import { authApi, useAuthUser } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'
import { chatPhone, formatPhone, LOCAL_SESSION, mentionIdsOf, sessionName, whatsappApi, whoIs, withMentionNames, type WhatsAppChat, type WhatsAppMessage } from './api'
import { applyMessage, isConversationMessage, watchEvents, type LiveState, type PushedMessage } from './events'
import { DocumentViewer, ImageViewer, MessageContent, useChatFiles, type ViewerImage } from './Attachments'
import { MessageDialogs, MessageMenu, useMessageActions, type ChatContext, type MessageDialog } from './MessageMenu'
import { ChatTagMenu, TagFilter, useTags, withTags, type Tags } from './Tags'
import { ChatActions, useReadChats } from './ChatActions'
import { WhatsAppAppLock } from './AppLock'
import { MediaLibrary } from './MediaLibrary'
import { ContactInfo } from './ContactInfo'

/** Connection check. Status changes also arrive instantly over the live stream; this catches anything it misses. */
const STATUS_POLL_MS = 2_000
/** Only while the live stream is down: re-reading the whole chat list is heavy for WhatsApp Web. */
const OFFLINE_CHATS_POLL_MS = 30_000
const OFFLINE_HISTORY_POLL_MS = 10_000
const LIVE_EVENTS = ['message.received', 'message.sent', 'session.status', 'session.qr', 'session.authenticated', 'session.disconnected']
const STEPS = ['Start WhatsApp', 'Scan code', 'Link phone', 'Load chats']
/** The gateway resolves at most 50 profile photos per request. */
const PICTURE_BATCH = 50

type Pictures = Record<string, string | null>

const when = (seconds: number) => new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
/** Chat-list time, as messaging apps show it: "9:07 pm" today, then "Yesterday", the weekday this week, else the date. */
export function shortWhen(seconds: number, now = new Date()): string {
  const date = new Date(seconds * 1000)
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days <= 0) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'short' })
  return date.toLocaleDateString(undefined, { dateStyle: 'short' })
}
const phoneOf = (waId: string) => waId.split('@')[0]
const chatName = (chat: WhatsAppChat) => chat.name || chatPhone(chat.id)

/** Profile photos for these chats, fetched once each in batches (top of the list first); new chats from the live stream get theirs
 *  as they appear. Refresh re-fetches all of them, since WhatsApp's photo links expire. Errors are returned for the page to show. */
function usePictures(sessionId: string | undefined, ids: string[]): { pictures: Pictures; error?: string } {
  const qc = useQueryClient()
  // A cache-only map: Refresh (invalidating ['whatsapp']) resets it to {}, which makes every photo load again.
  const { data: pictures } = useQuery({ queryKey: ['whatsapp', sessionId, 'pictures'], queryFn: () => ({}) as Pictures, enabled: !!sessionId, staleTime: Infinity })
  const [error, setError] = useState<string>()
  const inFlight = useRef(new Set<string>())
  const missing = pictures ? ids.filter((id) => !(id in pictures) && !inFlight.current.has(id)).join(',') : ''
  useEffect(() => {
    if (!sessionId || !missing) return
    const wanted = missing.split(',')
    wanted.forEach((id) => inFlight.current.add(id))
    void (async () => {
      for (let start = 0; start < wanted.length; start += PICTURE_BATCH) {
        const batch = wanted.slice(start, start + PICTURE_BATCH)
        const found = await whatsappApi.pictures(sessionId, batch).then(
          (result) => { setError(undefined); return result },
          (failure: Error) => { setError(failure.message); return {} as Pictures },
        )
        // Unanswered ids become null (initials), so a failing batch is not retried in a loop; Refresh tries again.
        qc.setQueryData<Pictures>(['whatsapp', sessionId, 'pictures'], (old = {}) => ({ ...old, ...Object.fromEntries(batch.map((id) => [id, found[id] ?? null])) }))
        batch.forEach((id) => inFlight.current.delete(id))
      }
    })()
  }, [sessionId, missing, qc])
  return { pictures: pictures ?? {}, error }
}

export function WhatsAppWorkspace() {
  const { user, loading } = useAuthUser()
  const email = user?.email?.toLowerCase()
  if (loading) return <Panel icon="Loader" spin title="Checking WhatsApp…" />
  // With server-checked sign-in every person links their own WhatsApp; RequireSignIn has already put a signed-in user here.
  // Without it (local mode, even after the optional browser sign-in) this computer keeps its one WhatsApp link.
  if (!authApi.configured) return <WhatsAppAppLock key={LOCAL_SESSION} name={LOCAL_SESSION}>{(lock) => <UserWhatsApp name={LOCAL_SESSION} onLock={lock} />}</WhatsAppAppLock>
  if (email) return <WhatsAppAppLock key={email} name={sessionName(email)}>{(lock) => <UserWhatsApp name={sessionName(email)} onLock={lock} />}</WhatsAppAppLock>
  return <Panel icon="LogIn" title="Sign in to use WhatsApp" text="Sign in with your company Google account first." />
}

function UserWhatsApp({ name, onLock }: { name: string; onLock: () => void }) {
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const openChat = useRef<string | null>(null)
  openChat.current = params.get('chat')
  const [live, setLive] = useState<LiveState>({ live: false })
  const [generation, setGeneration] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const mediaRequested = params.get('media') === '1'
  const [mediaOpen, setMediaOpen] = useState(mediaRequested)
  useEffect(() => { if (mediaRequested) setMediaOpen(true) }, [mediaRequested])

  const session = useQuery({ queryKey: ['whatsapp', name, 'session'], queryFn: () => whatsappApi.find(name), retry: false, refetchInterval: STATUS_POLL_MS })
  const current = session.data
  const sessionId = current?.id
  const ready = current?.status === 'ready'
  const chats = useQuery({
    queryKey: ['whatsapp', sessionId, 'chats'], queryFn: () => whatsappApi.chats(sessionId!), enabled: ready,
    // Pushed messages keep the list current, so it is read once; re-read only on Refresh or while the live stream is down.
    staleTime: Infinity, refetchInterval: live.live ? false : OFFLINE_CHATS_POLL_MS, retry: 1,
  })
  const ownId = current?.phone ? `${current.phone}@c.us` : null
  const photos = usePictures(ready ? sessionId : undefined, [...(ownId ? [ownId] : []), ...(chats.data ?? []).map((chat) => chat.id)])
  const tags = useTags(ready ? sessionId : undefined)
  const [tagFilter, setTagFilter] = useState<string[]>([])

  useEffect(() => {
    if (!sessionId) return
    let wasLive = false
    return watchEvents(sessionId, LIVE_EVENTS, ({ event, data }) => {
      if (event.startsWith('session.')) {
        void qc.invalidateQueries({ queryKey: ['whatsapp', name, 'session'] })
        if (event === 'session.qr') void qc.invalidateQueries({ queryKey: ['whatsapp', sessionId, 'qr'] })
        return
      }
      const message = data as PushedMessage
      if (!isConversationMessage(message)) return
      qc.setQueryData<WhatsAppChat[]>(['whatsapp', sessionId, 'chats'], (list) => list && applyMessage(list, message, openChat.current))
      qc.setQueryData<WhatsAppMessage[]>(['whatsapp', sessionId, 'history', message.chatId],
        (messages) => (messages && !messages.some((m) => m.id === message.id) ? [...messages, message] : messages))
    }, (state) => {
      // Back after a drop: catch up on whatever arrived while the stream was down.
      if (state.live && wasLive) void qc.invalidateQueries({ queryKey: ['whatsapp', sessionId] })
      wasLive ||= state.live
      setLive(state)
    })
  }, [sessionId, generation, name, qc])

  const connect = useMutation({ mutationFn: () => whatsappApi.connect(name, current ?? null), onSettled: () => qc.invalidateQueries({ queryKey: ['whatsapp', name] }) })
  const unlink = useMutation({ mutationFn: (id: string) => whatsappApi.logout(id), onSettled: () => qc.invalidateQueries({ queryKey: ['whatsapp'] }) })
  /** Re-reads everything and reopens the live stream; never unlinks. A broken link lands on the reconnect screen. */
  const refresh = async () => {
    setRefreshing(true)
    connect.reset()
    unlink.reset()
    setGeneration((value) => value + 1)
    try { await qc.invalidateQueries({ queryKey: ['whatsapp'] }) } finally { setRefreshing(false) }
  }

  const alerts = [
    current && session.isError && `Connection check failed: ${session.error.message}`,
    chats.isError && `Could not load chats: ${chats.error.message}`,
    connect.error?.message, unlink.error?.message,
    ready && live.error && `Live updates: ${live.error}`,
    ready && photos.error && `Could not load profile photos: ${photos.error}`,
  ].filter((value): value is string => !!value)

  let body: ReactNode
  if (session.isPending) body = <Panel icon="Loader" spin title="Checking WhatsApp…" step={0} />
  else if (ready && chats.data) {
    body = <Chats sessionId={current.id} chats={chats.data} pictures={photos.pictures} live={live.live}
      ownName={current.pushName || 'You'} ownPhone={current.phone ?? null} tags={tags} tagFilter={tagFilter} onTagFilter={setTagFilter}
      onLock={onLock} onLogout={() => setConfirmUnlink(true)} />
  }
  else if (ready) {
    body = chats.isError
      ? <Panel icon="CircleAlert" title="Could not load your chats" text={chats.error.message} action={<RefreshButton onClick={refresh} busy={refreshing} />} />
      : <Panel icon="MessageCircle" title="Loading your chats…" step={3} text="Right after linking, WhatsApp syncs your history first; this can take a minute or two, once.">
          <Elapsed />
        </Panel>
  } else if (session.isError) {
    body = <Panel icon="ServerOff" title="WhatsApp is not available" text={session.error.message} action={<RefreshButton onClick={refresh} busy={refreshing} />} />
  } else if (current?.status === 'qr_ready') body = <LinkCode sessionId={current.id} />
  else if (current?.status === 'authenticating') body = <Panel icon="Phone" title="Linking your phone…" step={2} text="Keep WhatsApp open on your phone for a few seconds." />
  else if (current?.status === 'initializing') {
    body = current.phone
      ? <Panel icon="RefreshCw" spin title="Reconnecting to WhatsApp…" step={0} text="Your phone is still linked; no new scan is needed." />
      : <Panel icon="Loader" spin title="Starting WhatsApp…" step={0} text="This takes a few seconds." />
  } else {
    // No session yet, or created / disconnected / failed / action_required: (re)connect.
    const relink = !!current?.phone
    body = (
      <Panel icon="MessageCircle" title={relink ? 'WhatsApp is disconnected' : 'Link your WhatsApp'}
        text={current?.lastError || (relink
          ? 'Reconnect uses your saved link. If WhatsApp asks to link again, a new code appears here.'
          : 'See your WhatsApp conversations inside GOMS. Unlink here or from your phone at any time.')}
        action={<Button variant="primary" disabled={connect.isPending} onClick={() => connect.mutate()}>
          <Icon name={connect.isPending ? 'Loader' : 'LogIn'} className={cn(connect.isPending && 'animate-spin')} />{relink ? 'Reconnect' : 'Connect WhatsApp'}
        </Button>} />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-2">
        {ready
          ? <PersonName person={{ name: current.pushName || current.phone || 'WhatsApp', photoUrl: ownId ? photos.pictures[ownId] : null }} size="sm"
              nameClassName="text-sm font-semibold text-ink" subtitle={current.phone ? formatPhone(current.phone) : undefined} />
          : <span className="text-sm font-semibold text-ink">WhatsApp</span>}
        {ready && <TagFilter tags={tags} selected={tagFilter} onChange={setTagFilter} />}
        {ready && <Button size="sm" variant="ghost" onClick={() => setMediaOpen(true)}><Icon name="FileImage" size={14} />Media</Button>}
        <span className="ml-auto" />
        {ready && <LiveBadge live={live.live} />}
        <RefreshButton onClick={refresh} busy={refreshing} />
        {/* Unlinking forces a new QR scan, so it sits apart from Refresh and asks first. */}
        {ready && <Button size="sm" variant="ghost" className="ml-2 text-crimson hover:text-crimson" disabled={unlink.isPending} onClick={() => setConfirmUnlink(true)}><Icon name="LogOut" />Unlink</Button>}
      </header>
      <Dialog open={confirmUnlink} onClose={() => setConfirmUnlink(false)} title="Unlink WhatsApp?"
        description="GOMS stops showing your chats, and linking again needs a new QR scan from your phone."
        footer={<>
          <Button onClick={() => setConfirmUnlink(false)}>Cancel</Button>
          <Button variant="danger" disabled={!current || unlink.isPending} onClick={() => { setConfirmUnlink(false); if (current) unlink.mutate(current.id) }}>Unlink</Button>
        </>}>
        <p className="text-sm text-muted">To only reload the page, use Refresh instead; it keeps you linked.</p>
      </Dialog>
      <Alerts messages={alerts} onRetry={refresh} />
      <div className="min-h-0 flex-1">{body}</div>
      {mediaOpen && ready && current && <MediaLibrary sessionId={current.id} chats={chats.data ?? []} tags={tags.tags} initialTags={tagFilter}
        pictures={photos.pictures} ownName={current.pushName || 'You'} ownPhone={current.phone ?? null} onClose={() => setMediaOpen(false)} />}
    </div>
  )
}

function RefreshButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return <Button size="sm" variant="ghost" disabled={busy} onClick={onClick} title="Reload WhatsApp without unlinking"><Icon name="RefreshCw" className={cn(busy && 'animate-spin')} />Refresh</Button>
}

function LiveBadge({ live }: { live: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-muted" title={live ? 'New messages appear instantly' : `Live updates reconnecting; checking every ${OFFLINE_CHATS_POLL_MS / 1000} s`}>
      <span className="relative flex h-2 w-2">
        {live && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-600 opacity-60 motion-safe:animate-ping" />}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', live ? 'bg-emerald-600' : 'bg-amber-600')} />
      </span>
      {live ? 'Live' : 'Reconnecting…'}
    </span>
  )
}

function Alerts({ messages, onRetry }: { messages: string[]; onRetry: () => void }) {
  if (messages.length === 0) return null
  return (
    <motion.div role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-700">
      <Icon name="TriangleAlert" className="mt-0.5 shrink-0" />
      <ul className="min-w-0 flex-1 space-y-0.5">{messages.map((message) => <li key={message}>{message}</li>)}</ul>
      <button onClick={onRetry} className="shrink-0 font-semibold underline-offset-2 hover:underline">Retry</button>
    </motion.div>
  )
}

function Panel({ icon, spin, title, text, step, action, children }: {
  icon: string; spin?: boolean; title: string; text?: string; step?: number; action?: ReactNode; children?: ReactNode
}) {
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <motion.section key={title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <Icon name={icon} size={28} className={cn('text-ink-600', spin && 'animate-spin')} />
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        {step !== undefined && <Progress step={step} />}
        {text && <p className="text-sm text-muted">{text}</p>}
        {children}
        {action}
      </motion.section>
    </div>
  )
}

/** Where linking stands, with a moving bar so a wait never looks frozen. */
function Progress({ step }: { step: number }) {
  const still = useReducedMotion()
  return (
    <div className="w-full max-w-sm">
      <ol className="flex justify-between gap-2 text-[11px] text-muted">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={index === step ? 'step' : undefined} className={cn('flex flex-1 flex-col items-center gap-1', index <= step && 'font-medium text-ink')}>
            <span className={cn('h-2.5 w-2.5 rounded-full', index < step ? 'bg-emerald-600' : index === step ? 'bg-ink-900 motion-safe:animate-pulse' : 'bg-line')} />
            {label}
          </li>
        ))}
      </ol>
      <div role="progressbar" aria-label={STEPS[step]} className="mt-3 h-1 overflow-hidden rounded-full bg-line">
        <motion.div className="h-full w-2/5 rounded-full bg-ink-900" animate={still ? undefined : { x: ['-100%', '250%'] }}
          transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }} />
      </div>
    </div>
  )
}

/** A ticking "waiting m:ss" so a long first sync visibly keeps going. */
function Elapsed() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  return <p className="text-[12px] tabular-nums text-muted" aria-live="off">Waiting {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</p>
}

function LinkCode({ sessionId }: { sessionId: string }) {
  // WhatsApp replaces the code about every 20 seconds; the live stream also announces each new one.
  const qr = useQuery({ queryKey: ['whatsapp', sessionId, 'qr'], queryFn: () => whatsappApi.qr(sessionId), refetchInterval: 5_000, retry: false })
  return (
    <Panel icon="Phone" title="Scan with your phone" step={1}
      text="On your phone open WhatsApp, go to Settings › Linked devices › Link a device, and scan this code.">
      {qr.data
        ? <motion.img key={qr.data.qrCode} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} src={qr.data.qrCode} alt="WhatsApp link code" className="h-64 w-64 rounded-xl border border-line bg-white p-2" />
        : <div className="flex h-64 w-64 items-center justify-center rounded-xl border border-line"><Icon name="Loader" className="animate-spin text-muted" /></div>}
      {qr.isError && <p role="alert" className="text-sm text-crimson">{qr.error.message}</p>}
    </Panel>
  )
}

function Chats({ sessionId, chats, pictures, live, ownName, ownPhone, tags, tagFilter, onTagFilter, onLock, onLogout }: {
  sessionId: string; chats: WhatsAppChat[]; pictures: Pictures; live: boolean; ownName: string; ownPhone: string | null
  tags: Tags; tagFilter: string[]; onTagFilter: (ids: string[]) => void
  onLock: () => void; onLogout: () => void
}) {
  const [menu, setMenu] = useState<{ chat: WhatsAppChat; x: number; y: number } | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const read = useReadChats(sessionId)
  const shown = withTags(chats, tags.tags, tagFilter)
  const [params, setParams] = useSearchParams()
  const selected = chats.find((chat) => chat.id === params.get('chat'))
  const qc = useQueryClient()
  const open = (chat: WhatsAppChat) => {
    qc.setQueryData<WhatsAppChat[]>(['whatsapp', sessionId, 'chats'], (list = []) => list.some((item) => item.id === chat.id) ? list : [chat, ...list])
    onTagFilter([])
    setParams({ chat: chat.id })
  }
  const toggleSelected = (id: string) => setSelection((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const unreadOpen = selected && selected.unreadCount > 0 ? selected.id : null
  // Opening a chat reads it, here and on the phone (as WhatsApp Web does); the badge and glow go at once.
  useEffect(() => {
    if (!unreadOpen) return
    qc.setQueryData<WhatsAppChat[]>(['whatsapp', sessionId, 'chats'], (old) => old?.map((chat) => (chat.id === unreadOpen ? { ...chat, unreadCount: 0 } : chat)))
    // Best effort: if the phone isn't told, it still shows unread there; nothing here depends on it.
    whatsappApi.markRead(sessionId, unreadOpen).catch(() => {})
  }, [unreadOpen, sessionId, qc])
  return (
    <div className="flex h-full min-h-0">
      <aside aria-label="Chats" className={cn('flex w-full min-h-0 flex-col border-r border-line bg-panel md:w-[30rem] md:max-w-[45%] md:shrink-0 xl:w-[36rem]', selected && 'hidden md:flex')}>
        <div className="flex min-h-16 shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-2">
          {selecting ? <>
            <button type="button" aria-label="Cancel chat selection" className="rounded-full p-2 hover:bg-ink-900/[0.06] focus-visible:focus-ring" onClick={() => { setSelecting(false); setSelection(new Set()) }}><Icon name="X" size={20} /></button>
            <span className="mr-auto text-sm font-semibold" role="status">{selection.size} selected</span>
            <Button size="sm" disabled={!selection.size || read.isPending} onClick={() => read.mutate([...selection])}>Mark as read</Button>
          </> : <>
            <h2 className="text-lg font-semibold text-ink">Chats</h2>
            <ChatActions sessionId={sessionId} chats={chats} onOpen={open} onSelect={() => setSelecting(true)}
              onMarkAllRead={() => read.mutate(chats.filter((chat) => chat.unreadCount > 0).map((chat) => chat.id))} markingRead={read.isPending} onLock={onLock} onLogout={onLogout} />
          </>}
        </div>
        {selecting && <label className="flex items-center gap-2 px-4 py-2 text-sm"><input type="checkbox" aria-label="Select all chats" checked={shown.length > 0 && shown.every((chat) => selection.has(chat.id))} onChange={(event) => setSelection(event.target.checked ? new Set(shown.map((chat) => chat.id)) : new Set())} />Select all</label>}
      <ul aria-label="Conversations" className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {chats.length === 0 && <li className="p-4 text-sm text-muted">No conversations yet.</li>}
        {chats.length > 0 && shown.length === 0 && (
          <li className="flex flex-col items-start gap-2 p-4 text-sm text-muted">
            No recent chats with {tagFilter.length === 1 ? 'this tag' : 'these tags'}.
            <Button size="sm" onClick={() => onTagFilter([])}><Icon name="X" />Clear selection</Button>
          </li>
        )}
        {shown.map((chat) => (
          <motion.li key={chat.id} layout="position"
            className={cn(selecting && 'flex items-center gap-2')}
            onContextMenu={(event) => { event.preventDefault(); if (!selecting) setMenu({ chat, x: event.clientX, y: event.clientY }) }}>
            {selecting && <input type="checkbox" aria-label={`Select ${chatName(chat)}`} className="ml-2" checked={selection.has(chat.id)} onChange={() => toggleSelected(chat.id)} />}
            <ChatCard sessionId={sessionId} chat={chat} tags={tags.tags.filter((tag) => tag.chatIds.includes(chat.id))} photoUrl={pictures[chat.id]} open={selecting ? selection.has(chat.id) : chat.id === selected?.id} onOpen={() => selecting ? toggleSelected(chat.id) : setParams({ chat: chat.id })} />
          </motion.li>
        ))}
      </ul>
      </aside>
      {menu && <ChatTagMenu key={menu.chat.id + menu.x + menu.y} chat={menu.chat} x={menu.x} y={menu.y} tags={tags} onClose={() => setMenu(null)} />}
      {selected
        // Keyed by chat: a reply in progress, an open menu or viewer never carries over to another chat.
        ? <Conversation key={selected.id} context={{ sessionId, chat: selected, chats, ownName, ownPhone }} photoUrl={pictures[selected.id]} live={live} onBack={() => setParams({})}
            pictures={pictures} tags={tags} onOpenChat={open} />
        : <p className="hidden flex-1 items-center justify-center text-sm text-muted md:flex">Pick a conversation.</p>}
    </div>
  )
}

/** The chat's photo, else initials, else (a number with no name, whose "initials" would be "++") a person icon. */
function ChatAvatar({ chat, photoUrl, size }: { chat: WhatsAppChat; photoUrl?: string | null; size: 'sm' | 'md' }) {
  if (!chat.name && !photoUrl) {
    return (
      <span aria-hidden="true" className={cn('flex shrink-0 items-center justify-center rounded-full bg-ink-900/10 text-ink-600', size === 'md' ? 'h-10 w-10' : 'h-8 w-8')}>
        <Icon name={chat.isGroup ? 'Users' : 'User'} size={size === 'md' ? 18 : 15} />
      </span>
    )
  }
  // No `id`: Avatar would look a WhatsApp id up in GOMS's Drive photos and drop the WhatsApp photo when none is found there.
  return <Avatar person={{ name: chatName(chat), photoUrl }} size={size} />
}

/** One chat as a card: photo, name and time, the latest message and unread count, then its tags. */
function ChatCard({ sessionId, chat, tags, photoUrl, open, onOpen }: { sessionId: string; chat: WhatsAppChat; tags: Tags['tags']; photoUrl?: string | null; open: boolean; onOpen: () => void }) {
  const unread = chat.unreadCount > 0
  const qc = useQueryClient()
  // Chat summaries omit mention metadata. Read just the latest message when needed, reusing open history and the name cache.
  const { data: latest } = useQuery({
    queryKey: ['whatsapp', sessionId, 'preview', chat.id, chat.lastMessage],
    queryFn: () => {
      const cached = qc.getQueryData<WhatsAppMessage[]>(['whatsapp', sessionId, 'history', chat.id])?.find((message) => message.body === chat.lastMessage)
      return cached ? [cached] : whatsappApi.history(sessionId, chat.id, 1)
    },
    enabled: /@\d{6,}/.test(chat.lastMessage ?? ''), staleTime: Infinity, retry: 1,
  })
  const mentions = useMentionNames(sessionId, (latest ?? []).filter((message) => message.body === chat.lastMessage))
  // A shared contact arrives as raw vCard text; show it as WhatsApp does ("👤 Name").
  const vcardName = chat.lastMessage?.startsWith('BEGIN:VCARD') ? /\nFN:([^\r\n]*)/.exec(chat.lastMessage)?.[1]?.trim() || 'Contact' : null
  const preview = vcardName ? `👤 ${vcardName}` : withMentionNames(chat.lastMessage ?? '', mentions)
  return (
    <button onClick={onOpen} aria-current={open ? 'true' : undefined}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm transition duration-150',
        'hover:-translate-y-px hover:shadow-md focus-visible:focus-ring motion-reduce:transform-none',
        open ? 'border-emerald-600/60 ring-1 ring-emerald-600/40' : 'border-line/70 hover:border-ink-600/25',
      )}>
      {/* Unread: a soft green glow pulses twice every 15 s until the chat is opened. */}
      {unread && <span aria-hidden="true" data-testid="unread-pulse"
        className="pointer-events-none absolute inset-0 rounded-xl bg-emerald-600/10 opacity-0 ring-2 ring-emerald-600/40 motion-safe:animate-unread-pulse" />}
      <ChatAvatar chat={chat} photoUrl={photoUrl} size="md" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-ink', unread ? 'font-semibold' : 'font-medium')}>
            {chat.isGroup && <Icon name="Users" size={13} className="shrink-0 text-muted" />}
            <span className="truncate" title={chatName(chat)}>{chatName(chat)}</span>
          </span>
          <span className={cn('shrink-0 text-[11px] tabular-nums', unread ? 'font-semibold text-emerald-600' : 'text-muted')}>{chat.timestamp ? shortWhen(chat.timestamp) : ''}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-[13px]', unread ? 'text-ink-700' : 'text-muted')}>{preview || ' '}</span>
          {unread && <span className="min-w-5 shrink-0 rounded-full bg-emerald-600 px-1.5 text-center text-[11px] font-semibold leading-5 text-white" aria-label={`${chat.unreadCount} unread`}>{chat.unreadCount}</span>}
        </span>
        {tags.length > 0 && (
          <span role="list" aria-label="Chat tags" className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
            {tags.map((tag) => (
              <span key={tag.id} role="listitem" title={tag.name}
                className="max-w-full truncate rounded border border-emerald-600/20 bg-emerald-600/[0.06] px-1.5 py-0.5 leading-none text-emerald-700">
                {tag.name}
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  )
}

function Conversation({ context, photoUrl, live, onBack, pictures, tags, onOpenChat }: {
  context: ChatContext; photoUrl?: string | null; live: boolean; onBack: () => void
  pictures: Pictures; tags: Tags; onOpenChat: (chat: WhatsAppChat) => void
}) {
  const { sessionId, chat } = context
  const [infoOpen, setInfoOpen] = useState(false)
  const [params] = useSearchParams()
  const messageParam = params.get('message')
  const replyParam = params.get('reply')
  const jumped = useRef<string | null>(null)
  const actions = useMessageActions(context)
  const [menu, setMenu] = useState<{ message: WhatsAppMessage; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<{ kind: MessageDialog; message: WhatsAppMessage } | null>(null)
  const [replyTo, setReplyTo] = useState<WhatsAppMessage | null>(null)
  const history = useQuery({
    queryKey: ['whatsapp', sessionId, 'history', chat.id], queryFn: () => whatsappApi.history(sessionId, chat.id),
    staleTime: live ? Infinity : 0, refetchInterval: live ? false : OFFLINE_HISTORY_POLL_MS,
  })
  // Empty "unknown" entries are WhatsApp system notices with nothing to show.
  const newestFirst = [...(history.data ?? [])].filter((message) => message.type !== 'unknown' || message.body).sort((a, b) => b.timestamp - a.timestamp)
  // Sends still on their way (the gateway types them out like a person, ~5 s) show at once as faded bubbles.
  const sending = useMutationState({ filters: { mutationKey: sendKey(sessionId, chat.id), status: 'pending' }, select: (mutation) => mutation.state.variables as Draft })
  const attachments = useChatFiles(sessionId, chat.id, history.data ?? [])
  const [viewing, setViewing] = useState<{ kind: 'image' | 'document'; id: string } | null>(null)
  const senderOf = (message: WhatsAppMessage) => (message.fromMe ? 'You' : chat.isGroup && message.author ? groupSender(message) : chatName(chat))
  // Group members' photos, through the same cache as the chat list's (privacy …@lid ids resolve too).
  const members = usePictures(chat.isGroup ? sessionId : undefined, [...new Set(newestFirst.flatMap((message) => (!message.fromMe && message.author ? [message.author] : [])))])
  const mentions = useMentionNames(sessionId, newestFirst)
  const photos: ViewerImage[] = [...newestFirst].reverse()
    .filter((message) => message.type === 'image' && attachments.files.get(message.id)?.blob)
    .map((message) => ({ id: message.id, file: attachments.files.get(message.id)!, caption: message.body || undefined, sender: senderOf(message), timestamp: message.timestamp }))
  const viewedDocument = viewing?.kind === 'document' ? attachments.files.get(viewing.id) : undefined
  // A reply's quote names who wrote the quoted message, as WhatsApp does, when that message is in the loaded history.
  const quotedAuthor = (id: string) => {
    const quoted = history.data?.find((message) => message.id === id)
    return quoted ? senderOf(quoted) : undefined
  }
  // Clicking a quote scrolls to the original and highlights it briefly.
  const [flash, setFlash] = useState<string | null>(null)
  const jumpTo = (id: string) => {
    const target = document.getElementById(bubbleId(id))
    if (!target) return
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlash(id)
    setTimeout(() => setFlash((current) => (current === id ? null : current)), 1500)
  }
  useEffect(() => {
    if (!messageParam || jumped.current === messageParam) return
    const message = history.data?.find((candidate) => candidate.id === messageParam)
    if (!message) return
    jumped.current = messageParam
    document.getElementById(bubbleId(message.id))?.scrollIntoView?.({ block: 'center', behavior: 'instant' })
    setFlash(message.id)
    if (replyParam === message.id) setReplyTo(message)
    const timer = setTimeout(() => setFlash(null), 1500)
    return () => clearTimeout(timer)
  }, [messageParam, replyParam, history.data])
  return (
    <section aria-label={`Conversation with ${chatName(chat)}`} className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Button size="icon" variant="ghost" className="md:hidden" aria-label="Back to conversations" onClick={onBack}><Icon name="ArrowLeft" /></Button>
        <button type="button" onClick={() => setInfoOpen(true)} aria-expanded={infoOpen} title={chat.isGroup ? 'Group info' : 'Contact info'}
          className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-ink-900/[0.04] focus-visible:focus-ring">
          <ChatAvatar chat={chat} photoUrl={photoUrl} size="sm" />
          <span className="truncate text-sm font-semibold text-ink">{chatName(chat)}</span>
        </button>
        {attachments.pendingIds.size > 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[12px] text-muted" role="status">
            <Icon name="Loader" size={13} className="animate-spin" />Loading {attachments.pendingIds.size} attachment{attachments.pendingIds.size === 1 ? '' : 's'}…
          </span>
        )}
      </header>
      {history.isError && <Alerts messages={[`Could not load messages: ${history.error.message}`]} onRetry={() => history.refetch()} />}
      {/* column-reverse keeps the view pinned to the newest message without scroll code. */}
      <ol className="flex flex-1 flex-col-reverse gap-1.5 overflow-y-auto bg-panel/60 p-4">
        {sending.map((draft, index) => (
          <motion.li key={`sending-${index}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="ml-auto max-w-[75%] rounded-xl rounded-br-sm bg-emerald-600/60 px-3 py-1.5 text-sm text-white shadow-sm">
            {draft.quoted && <Quote body={withMentionNames(draft.quoted.body, mentions)} author={quotedAuthor(draft.quoted.id)} onGreen />}
            <p className="whitespace-pre-wrap break-words">{draft.text}</p>
            <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-80"><Icon name="Clock" size={10} className="motion-safe:animate-pulse" />Sending…</p>
          </motion.li>
        ))}
        {history.isPending && <li className="flex items-center gap-2 text-sm text-muted"><Icon name="Loader" className="animate-spin" />Loading messages…</li>}
        {newestFirst.map((message) => (
          <motion.li key={message.id} id={bubbleId(message.id)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            onContextMenu={(event) => { event.preventDefault(); setMenu({ message, x: event.clientX, y: event.clientY }) }}
            className={cn('group relative max-w-[75%] rounded-xl px-3 py-1.5 text-sm shadow-sm transition-shadow duration-500', message.myReaction && 'mb-3',
              flash === message.id && 'ring-4 ring-amber-400/70',
              message.fromMe ? 'ml-auto rounded-br-sm bg-emerald-600 text-white' : 'mr-auto rounded-bl-sm border border-line bg-white text-ink')}>
            {/* The same menu without a right-click: for keyboards and touch screens. */}
            <button type="button" aria-label="Message options" onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setMenu({ message, x: box.left, y: box.bottom }) }}
              className={cn('absolute right-1 top-1 rounded-full p-0.5 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 focus-visible:focus-ring',
                message.fromMe ? 'bg-emerald-600 text-white' : 'bg-white text-ink-600')}>
              <Icon name="ChevronDown" size={14} />
            </button>
            {chat.isGroup && !message.fromMe && message.author && (
              <p className="mb-0.5 flex items-center gap-1.5 pr-5 text-[11px] font-semibold">
                <SenderAvatar name={groupSender(message)} photoUrl={members.pictures[message.author]} />
                <span className="truncate opacity-70">{groupSender(message)}</span>
              </p>
            )}
            {message.quotedMessage && <Quote body={withMentionNames(message.quotedMessage.body, mentions)} author={quotedAuthor(message.quotedMessage.id)} onGreen={message.fromMe}
              onJump={() => jumpTo(message.quotedMessage!.id)} />}
            {message.type === 'text' && !message.body.startsWith('BEGIN:VCARD')
              ? <p className="whitespace-pre-wrap break-words"><MentionText text={message.body} names={mentions} onGreen={message.fromMe} /></p>
              : <MessageContent message={message} file={attachments.files.get(message.id)} pending={attachments.pendingIds.has(message.id)}
                  error={attachments.error} onRetry={attachments.retry} onOpen={setViewing} />}
            <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-60">
              {message.pinned && <span role="img" aria-label="Pinned"><Icon name="Pin" size={10} /></span>}
              {message.starred && <span role="img" aria-label="Starred"><Icon name="Star" size={10} /></span>}
              {when(message.timestamp)}
            </p>
            {message.myReaction && (
              <span className={cn('absolute -bottom-3 rounded-full border border-line bg-white px-1.5 text-sm leading-6 shadow-sm', message.fromMe ? 'right-2' : 'left-2')}
                aria-label={`Your reaction ${message.myReaction}`}>{message.myReaction}</span>
            )}
          </motion.li>
        ))}
      </ol>
      <Composer sessionId={sessionId} chatId={chat.id} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
      {viewing?.kind === 'image' && <ImageViewer images={photos} startId={viewing.id} onClose={() => setViewing(null)} />}
      {viewing && viewedDocument && <DocumentViewer id={viewing.id} file={viewedDocument} onClose={() => setViewing(null)} />}
      {menu && <MessageMenu message={menu.message} file={attachments.files.get(menu.message.id)} x={menu.x} y={menu.y} actions={actions}
        onReply={() => setReplyTo(menu.message)} onDialog={(kind) => setDialog({ kind, message: menu.message })} onClose={() => setMenu(null)} />}
      {dialog && <MessageDialogs dialog={dialog.kind} message={dialog.message} file={attachments.files.get(dialog.message.id)} context={context} actions={actions} onClose={() => setDialog(null)} />}
      <AnimatePresence>
        {infoOpen && <ContactInfo context={context} photoUrl={photoUrl} pictures={pictures} tags={tags} messages={newestFirst} senderOf={senderOf}
          onOpenChat={onOpenChat} onJump={jumpTo} onClose={() => setInfoOpen(false)} onDeleted={onBack} />}
      </AnimatePresence>
    </section>
  )
}

/** A group member as WhatsApp names them: contact name, then real phone; the id's digits only as a last resort (often a privacy id). */
const groupSender = (message: WhatsAppMessage) =>
  message.contact?.name || message.contact?.pushName || (message.senderPhone ? formatPhone(message.senderPhone) : chatPhone(message.author ?? ''))

/** Who the loaded messages mention, by the id's digits: WhatsApp's name, else their phone. Each person is looked up once per
 *  session (Refresh looks again); people WhatsApp cannot identify keep their digits. */
function useMentionNames(sessionId: string, messages: WhatsAppMessage[]): Map<string, string> {
  const ids = [...new Set(messages.flatMap(mentionIdsOf))]
  const found = useQueries({ queries: ids.map((id) => ({ queryKey: ['whatsapp', sessionId, 'who', id], queryFn: () => whoIs(sessionId, id), staleTime: Infinity })) })
  return new Map(ids.flatMap((id, index) => {
    const who = found[index].data
    const label = who?.name || (who?.phone ? formatPhone(who.phone) : null)
    return label ? [[id.split('@')[0], label] as const] : []
  }))
}

/** Message text with mentions shown as WhatsApp does: "@Name", highlighted. */
function MentionText({ text, names, onGreen }: { text: string; names: Map<string, string>; onGreen?: boolean }) {
  // split with a capture group: odd entries are the mentioned ids' digits.
  return text.split(/@(\d{6,})/).map((part, index) => (index % 2
    ? <span key={index} className={onGreen ? 'font-semibold' : 'font-medium text-emerald-700'}>@{names.get(part) ?? part}</span>
    : part))
}

/** A group member's photo beside their name; a bare number (no name to take initials from) gets a person icon. */
function SenderAvatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  if (name.startsWith('+') && !photoUrl) {
    return <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-900/10 text-ink-600"><Icon name="User" size={12} /></span>
  }
  return <Avatar person={{ name, photoUrl }} size="xs" />
}

const bubbleId = (messageId: string) => `wa-message-${messageId}`

/** The message a reply answers, inside the reply's bubble as WhatsApp shows it: an inset with a bar, its author, then its text. */
function Quote({ body, author, onGreen, onJump }: { body: string; author?: string; onGreen?: boolean; onJump?: () => void }) {
  const content = (
    <>
      {author && <span className={cn('block truncate text-[12px] font-semibold', onGreen ? 'text-white' : 'text-emerald-700')}>{author}</span>}
      <span className="line-clamp-2 text-[13px] opacity-85">{body || 'Attachment'}</span>
    </>
  )
  const box = cn('mb-1 block w-full rounded-md border-l-4 bg-black/10 px-2 py-1 text-left', onGreen ? 'border-white/80' : 'border-emerald-600')
  return onJump
    ? <button type="button" onClick={onJump} className={cn(box, 'transition hover:bg-black/15')} aria-label={`Go to the quoted message${author ? ` from ${author}` : ''}`}>{content}</button>
    : <span className={box}>{content}</span>
}

type Draft = { text: string; quoted?: { id: string; body: string } }

const sendKey = (sessionId: string, chatId: string) => ['whatsapp', 'send', sessionId, chatId]

/** Writes in the open chat. Enter sends, Shift+Enter starts a new line. The box clears at once (the message shows as "Sending…");
 *  if WhatsApp refuses it, the text comes back into the box with the reason. */
function Composer({ sessionId, chatId, replyTo, onClearReply }: { sessionId: string; chatId: string; replyTo: WhatsAppMessage | null; onClearReply: () => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  // Choosing Reply puts the cursor here, as WhatsApp does.
  useEffect(() => { if (replyTo) box.current?.focus() }, [replyTo])
  // One idempotency key per text: sending the same text again after a failure or timeout cannot deliver it twice.
  const keys = useRef(new Map<string, string>())
  const send = useMutation({
    mutationKey: sendKey(sessionId, chatId),
    mutationFn: (draft: Draft) => {
      if (!keys.current.has(draft.text)) keys.current.set(draft.text, crypto.randomUUID())
      return whatsappApi.send(sessionId, chatId, draft.text, keys.current.get(draft.text)!, draft.quoted?.id)
    },
    onError: (_error, draft) => setText((current) => current || draft.text),
    onSuccess: ({ messageId, timestamp }, draft) => {
      keys.current.delete(draft.text)
      // Shown at once. The live stream's copy (same id) often arrives first, and the gateway sends it without the quote of a reply,
      // so the quote is merged into whichever copy is there.
      const message: PushedMessage = { id: messageId, chatId, body: draft.text, type: 'text', timestamp, fromMe: true, quotedMessage: draft.quoted }
      qc.setQueryData<WhatsAppMessage[]>(['whatsapp', sessionId, 'history', chatId], (list) => list && (list.some((m) => m.id === messageId)
        ? list.map((m) => (m.id === messageId ? { ...m, quotedMessage: m.quotedMessage ?? draft.quoted } : m))
        : [...list, message]))
      qc.setQueryData<WhatsAppChat[]>(['whatsapp', sessionId, 'chats'], (list) => list && applyMessage(list, message, chatId))
    },
  })
  const submit = () => {
    const draft = text.trim()
    if (!draft) return
    send.mutate({ text: draft, ...(replyTo && { quoted: { id: replyTo.id, body: replyTo.body || replyTo.type } }) })
    setText('')
    onClearReply()
  }
  return (
    <form onSubmit={(event) => { event.preventDefault(); submit() }} className="bg-panel/60 px-3 pb-3 pt-1.5">
      {send.isError && <p role="alert" className="mb-1.5 px-2 text-[13px] text-crimson">Not sent: {send.error.message} Your text is back in the box; press Send to try again.</p>}
      {replyTo && (
        <div className="mb-1.5 flex items-center gap-2 rounded-xl border-l-4 border-emerald-600 bg-white px-3 py-1.5 shadow-sm">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-emerald-600">Replying to {replyTo.fromMe ? 'yourself' : 'this message'}</p>
            <p className="truncate text-[13px] text-muted">{replyTo.body || replyTo.type}</p>
          </div>
          <button type="button" aria-label="Cancel reply" onClick={onClearReply} className="rounded-full p-1 text-muted hover:bg-ink-900/[0.06] hover:text-ink"><Icon name="X" size={14} /></button>
        </div>
      )}
      <div className="flex items-end gap-2 rounded-3xl border border-line bg-white py-1.5 pl-4 pr-1.5 shadow-sm transition focus-within:border-emerald-600/50 focus-within:ring-2 focus-within:ring-emerald-600/15">
        <textarea ref={box} aria-label="Message" value={text} maxLength={4096} rows={1} placeholder="Type a message"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } }}
          className="field-sizing-content max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm text-ink outline-none placeholder:text-muted" />
        <Button type="submit" variant="primary" aria-label="Send" disabled={!text.trim()}
          className="h-9 w-9 shrink-0 rounded-full bg-emerald-600 px-0 text-white hover:bg-emerald-700 disabled:opacity-35">
          <Icon name="Send" size={16} />
        </Button>
      </div>
    </form>
  )
}
