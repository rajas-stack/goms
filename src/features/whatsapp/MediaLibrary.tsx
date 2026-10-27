import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { repository } from '@/data/repository'
import { base64ToBytes } from '@/data/in-memory/makerDocuments'
import type { WhatsAppTag } from '@/lib/types'
import { Icon } from '@/components/ui/Icon'
import { Avatar } from '@/components/ui/Avatar'
import { useToast } from '@/components/ui/Toast'
import { GridContextMenu, type MenuEntry } from '@/modules/bid-tracker/components/GridContextMenu'
import { cn } from '@/lib/utils'
import { whatsappApi, type WhatsAppChat, type WhatsAppMessage } from './api'
import { DocumentViewer, ImageViewer, fileName, formatSize, parseVCards, previewOf, useObjectUrl, type ChatFile } from './Attachments'
import { MessageDialogs, useMessageActions, type MessageDialog } from './MessageMenu'
import { chatLabel, filterLibrary, itemSize, libraryGroups, libraryItems, type LibraryFilters, type LibraryGrouping, type LibraryItem, type LibraryTab } from './mediaLibraryModel'

const tool = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-ink-900/[0.07] hover:text-ink focus-visible:focus-ring active:scale-[0.97]'
const select = 'h-9 min-w-0 rounded-lg border border-line bg-paper px-2 text-[13px] text-ink focus-visible:focus-ring'
const tabs: LibraryTab[] = ['Media', 'Docs', 'Links', 'Contacts']

/** Read metadata in small batches. Opening the library must not download every chat's files. */
function useLibraryHistory(sessionId: string, chats: WhatsAppChat[]) {
  const [started, setStarted] = useState(3)
  const histories = useQueries({ queries: chats.map((chat, index) => ({
    queryKey: ['whatsapp', sessionId, 'history', chat.id], queryFn: () => whatsappApi.history(sessionId, chat.id),
    enabled: index < started, staleTime: Infinity, retry: false,
  })) })
  const settled = histories.slice(0, started).filter((query) => query.isSuccess || query.isError).length
  useEffect(() => {
    if (settled >= Math.min(started, chats.length) && started < chats.length) setStarted((count) => count + 3)
  }, [settled, started, chats.length])
  return histories
}

/** Prefer an opportunity's saved copy, then the archive, then WhatsApp's recent files (cached once per chat). */
async function loadItemFile(qc: QueryClient, sessionId: string, item: LibraryItem): Promise<ChatFile> {
  // A contact shared as a card carries its vCard in the text: save it as a .vcf the phone or Outlook can import.
  const card = parseVCards(item.message.body)
  if (card.length && !item.message.media) {
    const blob = new Blob([card.map((entry) => entry.vcard).join('\r\n')], { type: 'text/vcard' })
    return { blob, mimetype: blob.type, sizeBytes: blob.size, filename: `${card[0].name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'contact'}.vcf` }
  }
  const cached = qc.getQueryData<Map<string, ChatFile>>(['whatsapp', sessionId, 'attachments', item.chat.id])?.get(item.message.id)
  if (cached?.blob) return cached
  const kept = item.saved?.file
  let blob: Blob
  let filename = item.message.media?.filename || item.saved?.filename || ''
  if (kept) blob = new Blob([base64ToBytes(kept.base64) as Uint8Array<ArrayBuffer>], { type: kept.mimetype })
  else if (item.message.media?.data) blob = new Blob([base64ToBytes(item.message.media.data) as Uint8Array<ArrayBuffer>], { type: item.message.media.mimetype })
  else {
    try { blob = await whatsappApi.storedFile(sessionId, item.chat.id, item.message.id) }
    catch {
      const files = await qc.fetchQuery({ queryKey: ['whatsapp', sessionId, 'library-files', item.chat.id], staleTime: Infinity,
        queryFn: () => whatsappApi.attachments(sessionId, item.chat.id) })
      const media = files.get(item.message.id)
      if (!media?.data) throw new Error('WhatsApp can no longer provide this file. Try opening it on your phone.')
      filename ||= media.filename || ''
      blob = new Blob([base64ToBytes(media.data) as Uint8Array<ArrayBuffer>], { type: media.mimetype })
    }
  }
  return { blob, mimetype: blob.type, sizeBytes: blob.size, filename: filename || fileName(item.message, { mimetype: blob.type }) }
}

const fileKey = (sessionId: string, item: LibraryItem) => ['whatsapp', sessionId, 'library-file', item.chat.id, item.message.id]
function saveFile(file: ChatFile) {
  if (!file.blob) return
  const url = URL.createObjectURL(file.blob)
  Object.assign(document.createElement('a'), { href: url, download: file.filename }).click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function MediaLibrary({ sessionId, chats, tags, initialTags, pictures, ownName, ownPhone, onClose }: {
  sessionId: string; chats: WhatsAppChat[]; tags: WhatsAppTag[]; initialTags: string[]
  pictures: Record<string, string | null>; ownName: string; ownPhone: string | null; onClose: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const root = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<LibraryFilters>({ tab: 'Media', search: '', opportunity: '', person: '', tagIds: initialTags,
    chat: '', sentBy: 'all', sort: 'newest' })
  const [grouping, setGrouping] = useState<LibraryGrouping>('date')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState<{ item: LibraryItem; file: ChatFile } | null>(null)
  const [menu, setMenu] = useState<{ item: LibraryItem; x: number; y: number } | null>(null)
  const histories = useLibraryHistory(sessionId, chats)
  const filed = useQuery({ queryKey: ['whatsappLinks'], queryFn: () => repository.listWhatsAppLinks() })
  const opportunities = useQuery({ queryKey: ['bidsForGrid'], queryFn: () => repository.listBidsForGrid(), staleTime: 60_000 })
  const names = useMemo(() => new Map((opportunities.data ?? []).map((row) => [row.opportunityId, row.opportunityName || row.opportunityCode || 'Untitled opportunity'])), [opportunities.data])
  const items = libraryItems(chats, histories.map((query) => query.data), filed.data ?? [], tags)
  const shown = filterLibrary(items, filters, names)
  const groups = libraryGroups(shown, grouping, names)
  const people = [...new Map(items.map((item) => [item.personId, item.sender])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const opportunityIds = [...new Set(items.flatMap((item) => item.opportunities))]
  const completed = histories.filter((query) => query.isSuccess || query.isError).length
  const loading = completed < chats.length || filed.isPending
  const errors = histories.filter((query) => query.isError).length
  const change = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) => { setFilters((old) => ({ ...old, [key]: value })); setSelected([]) }
  const toggle = (id: string) => setSelected((old) => old.includes(id) ? old.filter((key) => key !== id) : [...old, id])
  const getFile = (item: LibraryItem) => qc.fetchQuery({ queryKey: fileKey(sessionId, item), queryFn: () => loadItemFile(qc, sessionId, item), staleTime: Infinity, retry: false })
  const open = async (item: LibraryItem, download = false) => {
    if (item.url) { window.open(item.url, '_blank', 'noopener,noreferrer'); return }
    setBusy(true)
    try {
      const file = await getFile(item)
      if (download || !previewOf(file)) saveFile(file)
      else setViewing({ item, file })
    } catch (error) { toast(`Could not open file: ${(error as Error).message}`, undefined, 'error') }
    finally { setBusy(false) }
  }
  const downloadSelected = async () => {
    setBusy(true)
    let failed = 0
    for (const item of shown.filter((candidate) => selected.includes(candidate.id) && !candidate.url)) {
      try { saveFile(await getFile(item)) } catch { failed++ }
    }
    if (failed) toast(`${failed} file${failed === 1 ? '' : 's'} could not be downloaded. Try opening them on your phone.`, undefined, 'error')
    setBusy(false)
  }
  const goTo = (item: LibraryItem, reply = false) => {
    qc.setQueryData<WhatsAppMessage[]>(['whatsapp', sessionId, 'history', item.chat.id], (old = []) =>
      old.some((message) => message.id === item.message.id) ? old : [...old, item.message])
    navigate(`/whatsapp?${new URLSearchParams({ chat: item.chat.id, message: item.message.id, ...(reply && { reply: item.message.id }) })}`)
    onClose()
  }

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    close.current?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  useEffect(() => { if (showSearch) search.current?.focus() }, [showSearch])

  const activeFilters = !!(filters.opportunity || filters.person || filters.tagIds.length || filters.chat || filters.sentBy !== 'all')
  const subtitle = filters.tagIds.length ? `From chats tagged ${tags.filter((tag) => filters.tagIds.includes(tag.id)).map((tag) => tag.name).join(', ')}` : `${filters.tab} from all chats`
  const emptyIcon = filters.tab === 'Media' ? 'FileImage' : filters.tab === 'Docs' ? 'FileText' : filters.tab === 'Contacts' ? 'IdCard' : 'Link2'
  return createPortal(
    <div data-canvas-ui className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 p-2 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={root} role="dialog" aria-modal="true" aria-label="Media library"
        className="relative flex h-[90dvh] max-h-[1000px] w-full max-w-[1440px] flex-col overflow-hidden rounded-2xl border border-line bg-paper text-ink shadow-pop"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !viewing && !menu) { event.stopPropagation(); if (showFilters) setShowFilters(false); else onClose() }
          if (event.key !== 'Tab' || viewing || menu) return
          const focusable = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, [tabindex="0"]') ?? [])]
          const first = focusable[0], last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }}>
        <header className="flex shrink-0 flex-wrap items-center gap-x-3 border-b border-line px-4 pt-3 sm:px-6 sm:pt-0">
          <div className="min-w-0 flex-1 py-2 sm:basis-52">
            <h2 className="text-base font-semibold">Media</h2><p className="truncate text-[12px] text-muted" title={subtitle}>{subtitle}</p>
          </div>
          <div role="tablist" aria-label="Attachment type" className="order-3 flex w-full sm:order-none sm:w-auto sm:flex-1">
            {tabs.map((tab) => <button key={tab} id={`library-tab-${tab}`} type="button" role="tab" aria-selected={filters.tab === tab} aria-controls="library-content"
              onClick={() => change('tab', tab)} onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
                change('tab', tabs[index]); document.getElementById(`library-tab-${tabs[index]}`)?.focus()
              }} tabIndex={filters.tab === tab ? 0 : -1}
              className={cn('flex h-14 flex-1 items-center justify-center gap-2 border-b-2 px-4 text-sm font-medium focus-visible:focus-ring sm:h-20 sm:min-w-24', filters.tab === tab ? 'border-emerald-600 text-ink' : 'border-transparent text-muted hover:text-ink')}>
              {tab}<span className="text-[11px] tabular-nums opacity-60">{filterLibrary(items, { ...filters, tab }, names).length}</span>
            </button>)}
          </div>
          <div className="flex items-center gap-1 sm:ml-auto">
            <button type="button" className={cn(tool, showSearch && 'bg-emerald-600/10 text-emerald-700')} aria-label="Search attachments" aria-expanded={showSearch} onClick={() => setShowSearch((value) => !value)}><Icon name="Search" size={20} /></button>
            <button type="button" className={cn(tool, (showFilters || activeFilters) && 'bg-emerald-600/10 text-emerald-700')} aria-label="Filter and sort" aria-expanded={showFilters} onClick={() => setShowFilters((value) => !value)}><Icon name="SlidersHorizontal" size={20} /></button>
            <button type="button" className={cn(tool, selecting && 'bg-emerald-600/10 text-emerald-700')} aria-label="Select attachments" aria-pressed={selecting} onClick={() => { setSelecting((value) => !value); setSelected([]) }}><Icon name="ClipboardCheck" size={20} /></button>
            <button ref={close} type="button" className={tool} aria-label="Close media library" onClick={onClose}><Icon name="X" size={22} /></button>
          </div>
        </header>
        {showSearch && <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2 sm:px-6"><Icon name="Search" className="text-muted" />
          <input ref={search} aria-label="Search media, documents and links" placeholder="Search files, captions, people or opportunities..." value={filters.search} onChange={(event) => change('search', event.target.value)} className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none" />
          {filters.search && <button className={tool} aria-label="Clear search" onClick={() => change('search', '')}><Icon name="X" size={15} /></button>}
        </div>}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel/40 px-4 py-2 sm:px-6">
          <span className="mr-1 text-[12px] text-muted">Organize by</span>
          <select aria-label="Organize by" className={select} value={grouping} onChange={(event) => setGrouping(event.target.value as LibraryGrouping)}>
            <option value="date">Date</option><option value="opportunity">Opportunity</option><option value="people">People</option><option value="tags">Tags</option>
          </select>
          <select aria-label="Filter by opportunity" className={cn(select, 'w-[calc(50%-0.25rem)] sm:w-auto sm:max-w-48')} value={filters.opportunity} onChange={(event) => change('opportunity', event.target.value)}>
            <option value="">All opportunities</option>{opportunityIds.map((id) => <option key={id} value={id}>{names.get(id) || 'Opportunity'}</option>)}
          </select>
          <select aria-label="Filter by person" className={cn(select, 'w-[calc(50%-0.25rem)] sm:w-auto sm:max-w-44')} value={filters.person} onChange={(event) => change('person', event.target.value)}>
            <option value="">All people</option>{people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <details className="relative">
            <summary className={cn(select, 'flex cursor-pointer list-none items-center gap-2', filters.tagIds.length > 0 && 'text-emerald-700')}><Icon name="Tag" size={13} />{filters.tagIds.length ? `${filters.tagIds.length} tags` : 'All tags'}<Icon name="ChevronDown" size={13} /></summary>
            <div className="absolute left-0 top-11 z-20 max-h-60 w-56 overflow-y-auto rounded-xl border border-line bg-paper p-2 shadow-pop">
              {!tags.length && <p className="p-2 text-[13px] text-muted">No tags yet.</p>}
              {tags.map((tag) => <label key={tag.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[13px] hover:bg-panel"><input type="checkbox" checked={filters.tagIds.includes(tag.id)} onChange={() => change('tagIds', filters.tagIds.includes(tag.id) ? filters.tagIds.filter((id) => id !== tag.id) : [...filters.tagIds, tag.id])} className="accent-emerald-600" />{tag.name}</label>)}
              {filters.tagIds.length > 0 && <button className="p-2 text-[13px] font-medium text-emerald-700" onClick={() => change('tagIds', [])}>Clear tags</button>}
            </div>
          </details>
          {activeFilters && <button className="inline-flex items-center gap-1 px-1 py-2 text-[12px] text-muted hover:text-ink" onClick={() => { setFilters((old) => ({ ...old, opportunity: '', person: '', tagIds: [], chat: '', sentBy: 'all' })); setSelected([]) }}><Icon name="FilterX" size={14} />Clear filters</button>}
        </div>
        {showFilters && <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-line bg-panel/30 px-4 py-3 text-[13px] sm:px-6">
          <fieldset className="flex items-center gap-3"><legend className="sr-only">Sent by</legend><span className="text-muted">Sent by</span>
            {(['all', 'you', 'others'] as const).map((value) => <label key={value} className="flex cursor-pointer items-center gap-1.5"><input type="radio" name="library-sender" value={value} checked={filters.sentBy === value} onChange={() => change('sentBy', value)} className="accent-emerald-600" />{value === 'all' ? 'All' : value === 'you' ? 'You' : 'Others'}</label>)}
          </fieldset>
          <label className="flex items-center gap-2 text-muted">Sort by<select aria-label="Sort attachments" className={select} value={filters.sort} onChange={(event) => change('sort', event.target.value as LibraryFilters['sort'])}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="largest">Largest</option></select></label>
          <select aria-label="Filter by chat" className={cn(select, 'max-w-60')} value={filters.chat} onChange={(event) => change('chat', event.target.value)}><option value="">All chats</option>{chats.map((chat) => <option key={chat.id} value={chat.id}>{chatLabel(chat)}</option>)}</select>
        </div>}
        {selecting && <div className="flex shrink-0 items-center gap-3 border-b border-line bg-emerald-600/[0.06] px-4 py-2 text-[13px] sm:px-6">
          <label className="flex items-center gap-2"><input type="checkbox" aria-label="Select all shown attachments" checked={shown.length > 0 && shown.every((item) => selected.includes(item.id))} onChange={(event) => setSelected(event.target.checked ? shown.map((item) => item.id) : [])} className="accent-emerald-600" />{selected.length} selected</label>
          {filters.tab !== 'Links' && <button className="ml-auto inline-flex items-center gap-1.5 font-medium text-emerald-700 disabled:opacity-40" disabled={!selected.length || busy} onClick={() => void downloadSelected()}><Icon name={busy ? 'Loader' : 'Download'} size={15} />Download</button>}
          {filters.tab === 'Links' && <button className="ml-auto font-medium text-emerald-700 disabled:opacity-40" disabled={!selected.length} onClick={() => void navigator.clipboard.writeText(shown.filter((item) => selected.includes(item.id)).map((item) => item.url).join('\n')).then(() => toast('Links copied'), () => toast('The browser blocked copying.', undefined, 'error'))}>Copy links</button>}
        </div>}
        {filters.tab !== 'Media' && <div aria-hidden="true" className="hidden shrink-0 grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_76px] gap-4 border-b border-line px-6 py-3 text-[12px] font-semibold sm:grid"><span>{filters.tab === 'Docs' ? 'Document' : filters.tab === 'Contacts' ? 'Contact' : 'Link'}</span><span>{filters.tab === 'Docs' ? 'Caption' : filters.tab === 'Contacts' ? 'Details' : 'Message'}</span><span>Sent by</span><span /></div>}
        <div id="library-content" role="tabpanel" aria-labelledby={`library-tab-${filters.tab}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {(errors > 0 || filed.isError || opportunities.isError) && <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-amber-600/20 bg-amber-600/10 px-6 py-2 text-[12px] text-ink">
            <Icon name="TriangleAlert" size={14} />{errors ? `${errors} chat${errors === 1 ? '' : 's'} could not be loaded. ` : ''}{filed.isError ? 'Filed attachments could not be loaded. ' : ''}{opportunities.isError ? 'Opportunity names could not be loaded. ' : ''}
            <button className="font-semibold underline" onClick={() => { histories.filter((query) => query.isError).forEach((query) => void query.refetch()); if (filed.isError) void filed.refetch(); if (opportunities.isError) void opportunities.refetch() }}>Retry</button>
          </div>}
          {!shown.length && <div className="flex min-h-64 flex-col items-center justify-center gap-2 p-8 text-center"><Icon name={loading ? 'Loader' : emptyIcon} size={32} className={cn('mb-2 text-muted', loading && 'animate-spin')} /><p className="text-sm font-medium">{loading ? 'Finding your attachments...' : `No ${filters.tab === 'Docs' ? 'documents' : filters.tab.toLowerCase()} found`}</p><p className="max-w-sm text-[13px] text-muted">{loading ? 'Your files will appear as chats load.' : activeFilters || filters.search ? 'Try changing the filters or search.' : 'Attachments shared in your chats will appear here.'}</p></div>}
          {groups.map(([key, group]) => <section key={key} aria-label={group.title}>
            <div className="flex items-center gap-3 px-4 pb-3 pt-5 sm:px-6"><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{group.title}</h3>{group.subtitle && <p className="mt-0.5 text-[12px] text-muted">{group.subtitle}</p>}</div><span className="text-[11px] tabular-nums text-muted">{group.items.length}</span></div>
            <div className={filters.tab === 'Media' ? 'grid grid-cols-2 gap-1 px-1 sm:grid-cols-3 lg:grid-cols-5' : 'px-4 sm:px-6'}>
              {group.items.map((item) => <LibraryEntry key={item.id} item={item} sessionId={sessionId} pictures={pictures} selecting={selecting} selected={selected.includes(item.id)} busy={busy}
                onSelect={() => toggle(item.id)} onOpen={() => void open(item)} onDownload={() => void open(item, true)} onMenu={(x, y) => setMenu({ item, x, y })} />)}
            </div>
          </section>)}
        </div>
        <footer className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2.5 text-[11px] text-muted sm:px-6" role="status">
          {loading && <Icon name="Loader" size={13} className="animate-spin" />}
          <span>{loading ? `Loading chats ${completed}/${chats.length}` : `${shown.length} ${shown.length === 1 ? 'item' : 'items'}`}</span>
          {busy && <span className="ml-2 flex items-center gap-1"><Icon name="Loader" size={12} className="animate-spin" />Opening file...</span>}
          <span className="ml-auto text-right">Recent 50 messages per chat + saved opportunity attachments</span>
        </footer>
      </div>
      {viewing && (viewing.item.message.type === 'image'
        ? <ImageViewer images={[{ id: viewing.item.id, file: viewing.file, sender: viewing.item.sender, caption: viewing.item.message.body, timestamp: viewing.item.message.timestamp }]} startId={viewing.item.id} onClose={() => { setViewing(null); close.current?.focus() }} />
        : <DocumentViewer id={`${sessionId}:${viewing.item.id}`} file={viewing.file} onClose={() => { setViewing(null); close.current?.focus() }} />)}
      {menu && <LibraryActions item={menu.item} sessionId={sessionId} chats={chats} ownName={ownName} ownPhone={ownPhone} x={menu.x} y={menu.y}
        onClose={() => setMenu(null)} onSelect={() => { setSelecting(true); toggle(menu.item.id) }} onOpen={() => void open(menu.item)} onDownload={() => void open(menu.item, true)} onGo={goTo} getFile={getFile} />}
    </div>, document.body,
  )
}

function LibraryEntry({ item, sessionId, pictures, selecting, selected, busy, onSelect, onOpen, onDownload, onMenu }: {
  item: LibraryItem; sessionId: string; pictures: Record<string, string | null>; selecting: boolean; selected: boolean; busy: boolean
  onSelect: () => void; onOpen: () => void; onDownload: () => void; onMenu: (x: number, y: number) => void
}) {
  const grid = item.tab === 'Media'
  const cards = item.tab === 'Contacts' ? parseVCards(item.message.body) : []
  const name = item.url ? new URL(item.url).hostname : cards.length ? cards.map((card) => card.name).join(', ')
    : item.message.media?.filename || item.saved?.filename || `${item.message.type[0].toUpperCase()}${item.message.type.slice(1)}`
  const caption = cards.length ? cards.flatMap((card) => [card.org, ...card.phones]).filter(Boolean).join(' · ') || 'No phone number'
    : item.message.body && item.message.body !== name && item.message.body !== item.url ? item.message.body : 'No caption'
  const date = new Date(item.message.timestamp * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  const icon = item.url ? 'Link2' : item.tab === 'Contacts' ? 'IdCard' : /\.(xlsx?|csv|ods)$/i.test(name) ? 'FileSpreadsheet' : 'FileText'
  const photo = pictures[item.message.fromMe ? '' : item.message.author || item.chat.id]
  return <article aria-label={`${name}, ${item.sender}`} className={cn('group relative min-w-0', grid ? 'aspect-square overflow-hidden bg-panel' : 'grid grid-cols-[minmax(0,1fr)_76px] items-center gap-x-3 gap-y-2 border-b border-line py-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_76px] sm:gap-4', selected && 'bg-emerald-600/10 ring-2 ring-inset ring-emerald-600')}
    onContextMenu={(event) => { event.preventDefault(); onMenu(event.clientX, event.clientY) }}>
    <button type="button" aria-label={`${selecting ? 'Select' : 'Open'} ${name}`} aria-pressed={selecting ? selected : undefined} onClick={selecting ? onSelect : onOpen}
      className={cn('min-w-0 text-left focus-visible:focus-ring', grid ? 'absolute inset-0 h-full w-full' : 'flex items-center gap-3')}>
      {grid ? <MediaThumbnail item={item} sessionId={sessionId} /> : <><span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-lg', icon === 'FileSpreadsheet' ? 'bg-emerald-600/10 text-emerald-700' : /\.pdf$/i.test(name) ? 'bg-crimson/10 text-crimson' : 'bg-panel text-muted')}><Icon name={icon} size={23} /></span><span className="min-w-0"><span className="block truncate text-[13px] font-semibold" title={item.url || name}>{name}</span><span className="mt-1 block truncate text-[11px] text-muted">{item.url ? item.url : [itemSize(item) ? formatSize(itemSize(item)) : null, name.split('.').length > 1 ? name.split('.').pop()?.toUpperCase() : 'Document'].filter(Boolean).join(' · ')}</span></span></>}
    </button>
    {grid ? <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-3 pt-10 text-[#fff]"><p className="truncate text-[13px] font-semibold">{item.sender}</p><p className="mt-0.5 truncate text-[11px] text-[#fff]/75">{chatLabel(item.chat)}</p></div>
      : <><p className="hidden line-clamp-2 text-[12px] text-muted sm:block" title={caption}>{caption}</p><div className="col-start-1 flex min-w-0 items-center gap-2 sm:col-start-auto"><Avatar person={{ name: item.sender, photoUrl: photo }} size="xs" /><span className="min-w-0"><span className="block truncate text-[12px] font-medium">{item.sender}</span><span className="block truncate text-[11px] text-muted" title={chatLabel(item.chat)}>{chatLabel(item.chat)} · {date}</span></span></div></>}
    {selecting && <input type="checkbox" checked={selected} aria-label={`Select attachment ${name}`} onChange={onSelect} className={cn('z-10 h-4 w-4 accent-emerald-600', grid ? 'absolute left-3 top-3' : 'absolute left-1 top-4')} />}
    <div className={cn('flex items-center justify-end', grid ? 'absolute right-1 top-1 rounded-full bg-black/35 text-[#fff]' : 'col-start-2 row-start-1 sm:col-start-4')}>
      {!grid && <button type="button" className={tool} disabled={busy} aria-label={item.url ? `Open link ${name}` : `Download ${name}`} onClick={item.url ? onOpen : onDownload}><Icon name={item.url ? 'ExternalLink' : 'Download'} size={17} /></button>}
      <button type="button" className={cn(tool, grid && 'text-[#fff] hover:bg-black/30 hover:text-[#fff]')} aria-label={`Options for ${name}`} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onMenu(rect.right, rect.bottom) }}><Icon name="ChevronDown" size={17} /></button>
    </div>
  </article>
}

function MediaThumbnail({ item, sessionId }: { item: LibraryItem; sessionId: string }) {
  const qc = useQueryClient()
  // Every thumbnail loads, in grid order: the media queue in api.ts runs them one at a time and waits out rate limits.
  const file = useQuery({ queryKey: fileKey(sessionId, item), queryFn: () => loadItemFile(qc, sessionId, item), enabled: ['image', 'sticker', 'video'].includes(item.message.type), staleTime: Infinity, retry: false })
  const url = useObjectUrl(file.data?.blob)
  const icon = item.message.type === 'video' ? 'Video' : ['audio', 'voice'].includes(item.message.type) ? 'PhoneCall' : 'FileImage'
  let content: ReactNode = url ? item.message.type === 'video' ? <video src={url} muted preload="metadata" className="h-full w-full object-cover" /> : <img src={url} alt={item.message.body || 'Shared photo'} className="h-full w-full object-cover" />
    : <span className="flex h-full flex-col items-center justify-center gap-2 px-3 pb-6 text-center text-muted"><Icon name={file.isFetching ? 'Loader' : icon} size={30} className={cn(file.isFetching && 'animate-spin')} /><span className="text-[11px]">{file.isError ? 'Preview unavailable · Click to retry' : item.message.type === 'voice' ? 'Voice message' : item.message.type === 'audio' ? 'Audio' : file.isFetching ? 'Loading preview...' : 'Open attachment'}</span></span>
  return <span className="block h-full w-full">{content}</span>
}

function LibraryActions({ item, sessionId, chats, ownName, ownPhone, x, y, onClose, onSelect, onOpen, onDownload, onGo, getFile }: {
  item: LibraryItem; sessionId: string; chats: WhatsAppChat[]; ownName: string; ownPhone: string | null; x: number; y: number
  onClose: () => void; onSelect: () => void; onOpen: () => void; onDownload: () => void; onGo: (item: LibraryItem, reply?: boolean) => void; getFile: (item: LibraryItem) => Promise<ChatFile>
}) {
  const context = { sessionId, chat: item.chat, chats, ownName, ownPhone }
  const actions = useMessageActions(context)
  const toast = useToast()
  const [dialog, setDialog] = useState<MessageDialog | null>(null)
  const [file, setFile] = useState<ChatFile>()
  const [menuOpen, setMenuOpen] = useState(true)
  const [preparing, setPreparing] = useState(false)
  useEffect(() => { if (!menuOpen && !dialog && !preparing) onClose() }, [menuOpen, dialog, preparing, onClose])
  const action = (fn: () => void) => () => { onClose(); fn() }
  const showDialog = async (kind: MessageDialog) => {
    setMenuOpen(false)
    setPreparing(true)
    if (kind === 'opportunity' && !item.url) {
      try { setFile(await getFile(item)) } catch { toast('The message will be filed without a file copy; WhatsApp could not provide it.') }
    }
    setDialog(kind)
    setPreparing(false)
  }
  const groups: MenuEntry[][] = [
    [{ label: 'Select', icon: 'ClipboardCheck', onSelect: action(onSelect) }, { label: item.url ? 'Open link in a new tab' : 'Open attachment', icon: item.url ? 'ExternalLink' : 'Eye', onSelect: action(onOpen) }],
    [{ label: 'Go to message', icon: 'MessageSquareText', onSelect: action(() => onGo(item)) }, { label: 'Reply', icon: 'Reply', onSelect: action(() => onGo(item, true)) },
      { label: 'Copy', icon: 'Copy', onSelect: action(() => void actions.copy(item.message)) },
      ...(!item.url ? [{ label: 'Download', icon: 'Download', onSelect: action(onDownload) }] : []),
      { label: 'Forward', icon: 'Forward', onSelect: () => void showDialog('forward') },
      { label: item.message.starred ? 'Unstar' : 'Star', icon: 'Star', onSelect: action(() => void actions.star(item.message, !item.message.starred)) }],
    [{ label: 'Add to opportunity', icon: 'Briefcase', onSelect: () => void showDialog('opportunity') }],
    [{ label: 'Delete', icon: 'Trash2', danger: true, onSelect: () => void showDialog('delete') }],
  ]
  return <>{menuOpen && <GridContextMenu x={x} y={y} title="Attachment options" groups={groups} onClose={() => setMenuOpen(false)} />}
    {dialog && <MessageDialogs dialog={dialog} message={item.message} file={file} context={context} actions={actions} onClose={onClose} />}</>
}

