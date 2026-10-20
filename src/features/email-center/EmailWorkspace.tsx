import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { COMMUNICATION_PARTIES, COMMUNICATION_PARTY_LABELS, type EmailEntity, type EmailEntityRef, type EmailItemRef, type EmailSummary } from '@goms/domain'
import { useAuthUser } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { emailApi, emailQueryDefaults, useEmailStatus } from './api'
import { ComposeDialog, type ComposeStart } from './ComposeDialog'
import { ConversationView } from './ConversationView'
import { EmailAccessDialog } from './AccessDialog'
import { EmailRecordPicker } from './RecordPicker'
import { EmailCategoryBadges } from './ParticipantPanel'
import { IconAction } from './IconAction'
import { MailAvatar, MailTime, MotionIn } from './emailUi'
import { Tooltip } from '@/components/ui/Tooltip'
import { Avatar } from '@/components/ui/Avatar'

const VIEW_ICON = { mailbox: 'User', context: 'Briefcase', team: 'Users', supervisor: 'ShieldCheck' } as const
const FOLDERS = [['INBOX', 'Inbox', 'Inbox'], ['SENT', 'Sent', 'Send'], ['DRAFT', 'Drafts', 'FilePenLine'], ['STARRED', 'Starred', 'Star'], ['ALL', 'All mail', 'Layers']] as const

export interface EmailWorkspaceProps { entity?: EmailEntityRef; title?: string; searchHint?: string; compact?: boolean }
export function EmailWorkspace(props: EmailWorkspaceProps) {
  const { user } = useAuthUser(); const email = user?.email?.toLowerCase()
  if (!email) return <p className="p-4 text-sm text-muted">Sign in with your company account to use Email Center.</p>
  return <AuthenticatedEmailWorkspace key={`${email}:${props.entity?.type ?? ''}:${props.entity?.id ?? ''}`} {...props} email={email} />
}
function AuthenticatedEmailWorkspace({ email, entity: originEntity, title = 'E-mail', searchHint = '', compact }: EmailWorkspaceProps & { email: string }) {
  const qc = useQueryClient(); const status = useEmailStatus(); const [params, setParams] = useSearchParams(); const location = useLocation()
  const pickedEntity = params.get('mailEntity') && params.get('mailEntityId') ? { type: params.get('mailEntity')!, id: params.get('mailEntityId')! } : null
  const scope = originEntity ?? pickedEntity ?? undefined
  const recordKey = scope ? `${scope.type}:${scope.id}` : 'mailbox'
  const [picking, setPicking] = useState(false); const [access, setAccess] = useState(false); const [compose, setCompose] = useState<ComposeStart | null>(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [searchText, setSearchText] = useState(params.get('mailSearch') ?? searchHint)
  const [sender, setSender] = useState(''); const [recipient, setRecipient] = useState(''); const [after, setAfter] = useState(''); const [before, setBefore] = useState(''); const [sort, setSort] = useState('newest')
  const [subject, setSubject] = useState(''); const [words, setWords] = useState(''); const [without, setWithout] = useState(''); const [hasFile, setHasFile] = useState(false); const [unreadOnly, setUnreadOnly] = useState(false); const [size, setSize] = useState('')
  const [category, setCategory] = useState(''); const [cursor, setCursor] = useState(0); const [pageToken, setPageToken] = useState<string>(); const [extra, setExtra] = useState<EmailSummary[]>([])
  const [moreContext, setMoreContext] = useState<ContextRow[]>([])
  const [showFilters, setShowFilters] = useState(false); const [unlinked, setUnlinked] = useState(false)
  const cap = (action: string) => status.data?.capabilities.some(value => value === action) ?? false
  const allowedViews = ['mailbox', ...(scope ? ['context'] : []), ...(scope && cap('team') ? ['team'] : []), ...(cap('supervisor') ? ['supervisor'] : [])]
  const requestedView = params.get('mailView') ?? (originEntity ? 'context' : 'mailbox'); const view = allowedViews.includes(requestedView) ? requestedView : allowedViews[0]
  const supervisory = view === 'supervisor'; const contextual = !!scope && view !== 'mailbox' && !unlinked
  function patch(values: Record<string, string | null>) { setParams(current => { const next = new URLSearchParams(current); for (const [key, value] of Object.entries(values)) value === null ? next.delete(key) : next.set(key, value); return next }, { replace: true }) }
  function resetList() { setCursor(0); setPageToken(undefined); setExtra([]); setMoreContext([]); patch({ mailItem: null, mailKind: null }) }
  const ownQuery = useQuery({ ...emailQueryDefaults, queryKey: ['emailCenter', email, 'mailboxes'], enabled: status.isSuccess, queryFn: () => emailApi(email).mailboxes.query({ mode: 'mine', supervisor: false }), refetchInterval: 30000 })
  const supervisors = useQuery({ ...emailQueryDefaults, queryKey: ['emailCenter', email, 'supervisorMailboxes', scope], enabled: supervisory && cap('supervisor'), queryFn: () => emailApi(email).mailboxes.query({ mode: 'supervisor', entity: scope, supervisor: true }), refetchInterval: 15000 })
  const ownMailboxes = ownQuery.isError ? [] : ownQuery.data ?? []; const mailboxes = supervisory ? supervisors.isError ? [] : supervisors.data ?? [] : ownMailboxes
  const mailbox = mailboxes.find(mailbox => mailbox.id === params.get('mailbox')) ?? mailboxes[0]
  const folder = params.get('mailFolder') ?? (searchHint ? 'ALL' : 'INBOX')
  const search = params.get('mailSearch') ?? ''
  const labels = useQuery({ ...emailQueryDefaults, queryKey: ['emailCenter', email, 'labels', mailbox?.id], enabled: !!mailbox?.own && mailbox.status === 'connected', queryFn: () => emailApi(email).labels.query({ mailboxId: mailbox!.id }) })
  const userLabels = labels.data?.filter(label => label.type === 'user') ?? []
  const pickedLabel = userLabels.find(label => label.id === folder)
  const labelClause = pickedLabel ? `{${[pickedLabel, ...userLabels.filter(label => label.name.startsWith(`${pickedLabel.name}/`))].map(label => `label:"${label.name.replace(/["\\\r\n]/g, '')}"`).join(' ')}}` : ''
  const clauses = [search, labelClause, subject ? `subject:("${subject.replace(/["\\\r\n]/g, '')}")` : '', words ? `"${words.replace(/["\\\r\n]/g, '')}"` : '', without ? `-{"${without.replace(/["\\\r\n]/g, '')}"}` : '', hasFile ? 'has:attachment' : '', unreadOnly ? 'is:unread' : '', size, sender ? `from:"${sender.replace(/["\\\r\n]/g, '')}"` : '', recipient ? `{to:"${recipient.replace(/["\\\r\n]/g, '')}" cc:"${recipient.replace(/["\\\r\n]/g, '')}"}` : '', after ? `after:${Math.floor(new Date(`${after}T00:00:00`).getTime() / 1000)}` : '', before ? `before:${Math.floor(new Date(`${before}T00:00:00`).getTime() / 1000) + 86400}` : ''].filter(Boolean).join(' ')
  const list = useQuery({ ...emailQueryDefaults, queryKey: ['emailCenter', email, 'list', mailbox?.id, folder, clauses, pageToken, supervisory, scope, unlinked], enabled: !!mailbox && mailbox.status === 'connected' && !contextual && status.isSuccess, queryFn: () => emailApi(email).list.query({ mailboxId: mailbox!.id, folder: pickedLabel ? 'ALL' : folder, q: clauses, pageToken, supervisor: supervisory, entity: supervisory ? scope : undefined, unlinkedOnly: supervisory && (unlinked || !scope) }), refetchInterval: 30000 })
  const contextQuery = useQuery({ ...emailQueryDefaults, queryKey: ['emailCenter', email, 'context', scope, view, mailbox?.id, cursor], enabled: contextual && !!scope && status.isSuccess, queryFn: () => emailApi(email).context.query({ entity: scope!, mode: view === 'team' ? 'team' : supervisory ? 'supervisor' : 'mine', mailboxId: mailbox?.id, cursor }), refetchInterval: 15000 })
  type ContextRow = NonNullable<typeof contextQuery.data>['items'][number]
  const selectedId = params.get('mailRecord') === recordKey ? params.get('mailItem') : null; const selectedKind = params.get('mailKind') === 'message' ? 'message' : 'thread'
  const selected: EmailItemRef | null = mailbox && selectedId ? { mailboxId: params.get('mailItemMailbox') ?? mailbox.id, kind: selectedKind, id: selectedId } : null
  const allContext = contextQuery.isError ? [] : [...moreContext, ...(contextQuery.data?.items ?? [])]
  const allMail = list.isError ? [] : [...extra, ...(list.data?.items ?? [])]
  // Real-time search: what is typed filters the loaded rows at once; Gmail is searched 350 ms after typing stops.
  const typed = searchText.trim().toLowerCase()
  useEffect(() => {
    if (searchText.trim() === search) return
    const timer = window.setTimeout(() => { resetList(); patch({ mailSearch: searchText.trim() || null }) }, 350)
    return () => window.clearTimeout(timer)
    // resetList/patch are stable in effect; only the typed text drives the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText])
  const contextFiltered = allContext.filter(row => {
    if (category && row.link.category !== category) return false
    if (!row.summary) return !search && !sender && !recipient && !after && !before
    const value = row.summary
    return (!typed || `${value.subject} ${value.snippet} ${value.participants.map(person => `${person.name} ${person.email}`).join(' ')}`.toLowerCase().includes(typed))
      && (!sender || value.from.some(person => person.email.toLowerCase().includes(sender.toLowerCase()))) && (!recipient || value.participants.some(person => person.email.toLowerCase().includes(recipient.toLowerCase())))
      && (!after || value.date.slice(0, 10) >= after) && (!before || value.date.slice(0, 10) <= before)
  }).sort((a, b) => (a.summary?.date ?? '').localeCompare(b.summary?.date ?? '') * (sort === 'newest' ? -1 : 1))
  const mailSorted = [...allMail].filter(row => !typed || `${row.subject} ${row.snippet} ${row.from.map(person => `${person.name} ${person.email}`).join(' ')}`.toLowerCase().includes(typed) || typed === search.toLowerCase()).sort((a, b) => a.date.localeCompare(b.date) * (sort === 'newest' ? -1 : 1))
  async function run(action: () => Promise<unknown>, success?: string) { setBusy(true); setError(''); try { await action(); if (success) setNotice(success) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Email action failed.') } finally { setBusy(false) } }
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['emailCenter', email] }) }
  const select = (item: EmailItemRef) => patch({ mailItem: item.id, mailKind: item.kind, mailItemMailbox: item.mailboxId, mailRecord: recordKey })
  const viewLabel = (value: string) => value === 'mailbox' ? 'My Mailbox' : value === 'context' ? scope?.type === 'opportunity' ? 'Opportunity Communications' : 'Record Communications' : value === 'team' ? 'Team Communications' : 'Supervisor View'
  const searchForm = <form className="flex min-w-56 flex-1 items-center gap-1.5" onSubmit={event => { event.preventDefault(); resetList(); patch({ mailSearch: searchText || null }) }}><span className="relative flex-1"><Input aria-label="Search email" placeholder={contextual ? 'Search loaded correspondence…' : 'Search Gmail…'} value={searchText} onChange={event => setSearchText(event.target.value)} className="pr-9" />{searchText && <Tooltip label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2"><button type="button" aria-label="Clear search" onClick={() => setSearchText('')} className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-ink-900/[0.06] hover:text-ink-900"><Icon name="X" size={14} /></button></Tooltip>}</span><IconAction icon="Search" label="Search" type="submit" />{originEntity && view !== 'mailbox' && <IconAction icon="Link2" label="Find mail to link" onClick={() => { resetList(); setSearchText(searchHint); patch({ mailView: 'mailbox', mailFolder: 'ALL', mailSearch: searchHint || null }) }} />}</form>
  return <section className={`flex min-h-0 flex-col ${compact ? '' : 'h-full'}`} aria-label="Email Center">
    <header className="space-y-4 border-b border-line px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h1 className="text-lg font-semibold">{title}</h1><p className="mt-0.5 truncate text-xs text-muted">{email}{mailbox?.lastSyncAt ? ` · Last sync ${new Date(mailbox.lastSyncAt).toLocaleString()}` : ''}</p></div>
        <div className="flex items-center gap-1.5">
          {!ownMailboxes.some(m => m.status === 'connected') && <IconAction icon="Link2" label="Connect Gmail" disabled={busy || !status.data?.ready} onClick={() => void run(async () => { const connection = await emailApi(email).connect.mutate({ returnTo: `${location.pathname}${location.search}` }); window.location.assign(connection.url) })} />}
          <IconAction icon="RefreshCw" label="Refresh" onClick={refresh} disabled={busy} />
          {cap('manageAccess') && <IconAction icon="ShieldCheck" label="Manage access" onClick={() => setAccess(true)} />}
          {mailbox?.own && <IconAction icon="LogOut" label="Disconnect mailbox" disabled={busy} onClick={() => { if (window.confirm(`Disconnect ${mailbox.email}? Synchronization stops and supervisory grants are revoked.`)) void run(async () => { await emailApi(email).disconnect.mutate({ mailboxId: mailbox.id, confirmed: true }); refresh() }, 'Mailbox disconnected. Gmail messages and relationship history were retained.') }} />}
        </div>
      </div>
      <div role="tablist" aria-label="Communication views" className="flex flex-wrap items-center gap-1">{allowedViews.map(value => <Tooltip key={value} label={viewLabel(value)}><button role="tab" aria-label={viewLabel(value)} aria-selected={view === value} onClick={() => { resetList(); patch({ mailView: value }); setUnlinked(false) }} className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors focus-visible:focus-ring ${view === value ? 'bg-ink-900 text-paper' : 'text-muted hover:bg-ink-900/[0.05] hover:text-ink-900'}`}><Icon name={VIEW_ICON[value as keyof typeof VIEW_ICON] ?? 'Mail'} size={15} />{view === value && <span>{viewLabel(value)}</span>}</button></Tooltip>)}{!originEntity && <IconAction icon="Briefcase" variant="ghost" className="ml-auto" label={pickedEntity ? 'Change selected record' : 'Choose business record'} onClick={() => setPicking(true)} />}</div>
      {(status.error || ownQuery.error || error || (supervisory && supervisors.error)) && <p role="alert" className="text-sm text-crimson">{error || status.error?.message || ownQuery.error?.message || supervisors.error?.message}</p>}
      {status.data && !status.data.ready && <p className="text-sm text-muted">Gmail connection needs the server’s Google OAuth client and encryption configuration. Existing modules remain available.</p>}
      {(notice || params.get('email_connection')) && <p role="status" className="text-sm text-muted">{notice || (params.get('email_connection') === 'connected' ? 'Gmail connected.' : 'Gmail connection was cancelled or needs another attempt. Use the same approved company account and grant Gmail access.')}</p>}
      {mailbox?.lastError && <p role="alert" className="text-xs text-crimson">{mailbox.lastError}</p>}
      <div className="flex flex-wrap items-center gap-3"><div role="radiogroup" aria-label="Mailbox owner" className="flex items-center -space-x-1">{!mailboxes.length && <span className="text-[13px] text-muted">No connected mailbox</span>}{mailboxes.map(m => <Tooltip key={m.id} label={`${m.ownerEmail} · ${m.status}`}><button role="radio" aria-checked={mailbox?.id === m.id} aria-label={`${m.ownerEmail} (${m.status})`} onClick={() => { resetList(); patch({ mailbox: m.id }) }} className={`relative rounded-full ring-2 transition ${mailbox?.id === m.id ? 'ring-goms-navy' : 'ring-paper opacity-70 hover:opacity-100'}`}><Avatar person={{ name: m.ownerEmail }} size="sm" /><span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-paper ${m.status === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden /></button></Tooltip>)}</div>
        {cap('send') && <IconAction icon="Pencil" label="Compose" variant="primary" disabled={!ownMailboxes.some(m => m.status === 'connected')} onClick={() => setCompose({ mode: 'new' })} />}
        {!contextual && <div role="radiogroup" aria-label="Gmail folder" className="flex items-center gap-0.5 rounded-lg border border-line bg-white p-0.5">{FOLDERS.map(([value, label, icon]) => <Tooltip key={value} label={label}><button role="radio" aria-checked={folder === value} aria-label={label} onClick={() => { resetList(); patch({ mailFolder: value }) }} className={`grid h-8 w-8 place-items-center rounded-md transition-colors ${folder === value ? 'bg-ink-900 text-paper' : 'text-muted hover:bg-ink-900/[0.05] hover:text-ink-900'}`}><Icon name={icon} size={15} /></button></Tooltip>)}{!!labels.data?.some(label => label.type === 'user') && <Select aria-label="Gmail label" value={FOLDERS.some(([value]) => value === folder) ? '' : folder} className="ml-1 h-8 w-auto max-w-36 border-0 text-[13px]" onChange={event => { if (event.target.value) { resetList(); patch({ mailFolder: event.target.value }) } }}><option value="">Labels…</option>{labels.data?.filter(label => label.type === 'user').map(label => <option key={label.id} value={label.id}>{label.name}</option>)}</Select>}</div>}
        {supervisory && <Select aria-label="Linked status" className="w-auto" value={unlinked || !scope ? 'mailbox' : 'linked'} onChange={event => { resetList(); setUnlinked(event.target.value === 'mailbox') }}><option value="linked" disabled={!scope}>Linked to selected record</option><option value="mailbox">Unlinked correspondence (separate approval required)</option></Select>}
        {searchForm}<IconAction icon="SlidersHorizontal" label={showFilters ? 'Hide filters' : 'Filters'} variant={showFilters ? 'primary' : undefined} onClick={() => setShowFilters(value => !value)} />
      </div>
      {showFilters && <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <IconAction icon="ArrowDownUp" label={sort === 'newest' ? 'Newest first (click for oldest)' : 'Oldest first (click for newest)'} className="h-8 w-8" onClick={() => setSort(value => value === 'newest' ? 'oldest' : 'newest')} />
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        {([['From', sender, setSender, 'w-36'], ['To', recipient, setRecipient, 'w-36'], ['Subject', subject, setSubject, 'w-36'], ['Has words', words, setWords, 'w-32'], ["Doesn't have", without, setWithout, 'w-32']] as const).map(([label, value, set, width]) =>
          <Input key={label} aria-label={label} placeholder={label} value={value} onChange={event => { resetList(); set(event.target.value) }} className={`h-8 ${width} text-[12.5px]`} />)}
        <Tooltip label="After date"><Input type="date" aria-label="After date" value={after} onChange={event => { resetList(); setAfter(event.target.value) }} className="h-8 w-36 text-[12.5px]" /></Tooltip>
        <Tooltip label="Before date"><Input type="date" aria-label="Before date" value={before} onChange={event => { resetList(); setBefore(event.target.value) }} className="h-8 w-36 text-[12.5px]" /></Tooltip>
        <IconAction icon="Paperclip" label="Has attachment" className="h-8 w-8" variant={hasFile ? 'primary' : undefined} aria-pressed={hasFile} onClick={() => { resetList(); setHasFile(value => !value) }} />
        <IconAction icon="Mail" label="Unread only" className="h-8 w-8" variant={unreadOnly ? 'primary' : undefined} aria-pressed={unreadOnly} onClick={() => { resetList(); setUnreadOnly(value => !value) }} />
        <Select aria-label="Size" value={size} onChange={event => { resetList(); setSize(event.target.value) }} className="h-8 w-auto text-[12.5px]"><option value="">Any size</option><option value="larger:1M">&gt; 1 MB</option><option value="larger:5M">&gt; 5 MB</option><option value="larger:10M">&gt; 10 MB</option><option value="smaller:1M">&lt; 1 MB</option></Select>
        {contextual && <Select aria-label="Manual category" value={category} onChange={event => setCategory(event.target.value)} className="h-8 w-auto text-[12.5px]"><option value="">All categories</option>{COMMUNICATION_PARTIES.map(value => <option key={value} value={value}>{COMMUNICATION_PARTY_LABELS[value]}</option>)}</Select>}
        {(sender || recipient || subject || words || without || after || before || hasFile || unreadOnly || size || category) && <IconAction icon="X" label="Clear all filters" variant="ghost" className="h-8 w-8" onClick={() => { resetList(); setSender(''); setRecipient(''); setSubject(''); setWords(''); setWithout(''); setAfter(''); setBefore(''); setHasFile(false); setUnreadOnly(false); setSize(''); setCategory('') }} />}
      </div>}
      {view === 'team' && <p className="text-xs text-muted">Only correspondence delivered to your mailbox is shown. Other bid members do not gain access merely by being on the Opportunity.</p>}
    </header>
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[minmax(320px,0.38fr)_minmax(0,0.62fr)]">
      <div className="min-h-40 overflow-y-auto border-b border-line lg:border-b-0 lg:border-r">
        {(!mailboxes.length && !ownQuery.isLoading && !supervisors.isLoading) && <p className="p-5 text-sm text-muted">{supervisory ? 'No approved mailbox scope. A portal role alone does not authorize employee email access.' : 'Connect your company Gmail to read and link correspondence.'}</p>}
        {(contextQuery.isLoading && contextual || list.isLoading && !contextual) && <p role="status" className="p-4 text-sm text-muted">Loading correspondence…</p>}
        {(contextual ? contextQuery.error : list.error) && <p role="alert" className="p-4 text-sm text-crimson">{contextual ? contextQuery.error?.message : list.error?.message}</p>}
        {contextual ? contextFiltered.map((row, index) => <div key={`${row.link.id}:${row.link.item.mailboxId}:${index}`} className="border-b border-line"><button className={`w-full px-5 py-4 text-left transition-colors focus-visible:focus-ring ${selected?.id === row.link.item.id && selected.mailboxId === row.link.item.mailboxId ? 'bg-panel' : 'hover:bg-panel/50'}`} onClick={() => select(row.link.item)} disabled={!row.summary}><p className="text-xs text-muted">{row.ownerEmail} · {row.link.item.kind}{row.link.copy ? ' · delivered copy' : ''}</p><p className="mt-1 break-words text-sm font-medium">{row.summary?.subject ?? 'Email unavailable'}</p><p className="mt-1 line-clamp-2 text-xs text-muted">{row.error || row.summary?.snippet}</p>{row.summary && <p className="mt-2 flex items-center gap-2 text-xs text-muted"><MailTime iso={row.summary.date} />{row.summary.messageCount > 1 && <span>{row.summary.messageCount} messages</span>}</p>}{row.summary && !row.link.category && <EmailCategoryBadges participants={row.summary.participants} ownerEmail={row.ownerEmail} />}{row.link.category && <p className="mt-1 text-xs text-muted">{COMMUNICATION_PARTY_LABELS[row.link.category as keyof typeof COMMUNICATION_PARTY_LABELS] ?? row.link.category}</p>}</button>{row.link.own && cap('link') && <div className="px-4 pb-3"><Select aria-label={`Category for ${row.summary?.subject ?? 'unavailable email'}`} className="h-8 text-xs" value={row.link.category ?? ''} disabled={busy} onChange={event => void run(async () => { await emailApi(email).setCategory.mutate({ id: row.link.id, category: event.target.value as typeof COMMUNICATION_PARTIES[number] || null }); refresh() })}><option value="">Automatic participant categories</option>{COMMUNICATION_PARTIES.map(value => <option key={value} value={value}>{COMMUNICATION_PARTY_LABELS[value]}</option>)}</Select></div>}</div>) : mailSorted.map((row, index) => {
          const sender = row.from[0] ?? { name: '', email: '' }, unread = row.labels.includes('UNREAD'), active = selected?.id === row.threadId
          return <MotionIn key={`${row.id}:${index}`} delay={index * 0.015}><button className={`group relative flex w-full gap-3 border-b border-line/70 px-5 py-4 text-left transition-colors focus-visible:focus-ring ${active ? 'bg-goms-sky/[0.12]' : 'hover:bg-ink-900/[0.03]'}`} onClick={() => row.draftId ? setCompose({ mode: 'draft', draftId: row.draftId, item: { mailboxId: mailbox!.id, kind: 'message', id: row.id } }) : select({ mailboxId: mailbox!.id, kind: 'thread', id: row.threadId })}>
            {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-goms-navy" aria-hidden />}
            <MailAvatar person={sender} size="md" />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3"><span className={`truncate text-[14px] ${unread ? 'font-semibold text-ink-900' : 'font-medium text-ink-800'}`}>{row.from.map(person => person.name || person.email).join(', ') || '(Unknown sender)'}</span><MailTime iso={row.date} className={unread ? 'font-semibold text-goms-navy' : ''} /></span>
              <span className={`mt-0.5 flex items-center gap-1.5 text-[13.5px] ${unread ? 'font-semibold text-ink-900' : 'text-ink-700'}`}>{unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-goms-navy" aria-label="Unread" />}<span className="truncate">{row.subject || '(No subject)'}</span></span>
              <span className="mt-1 flex items-center gap-2"><span className="line-clamp-1 flex-1 text-[12.5px] text-muted">{row.snippet}</span>{row.messageCount > 1 && <span className="shrink-0 rounded-full bg-ink-900/[0.06] px-1.5 text-[11px] font-medium tabular-nums text-ink-600" title={`${row.messageCount} messages`}>{row.messageCount}</span>}{row.labels.includes('STARRED') && <Icon name="Star" size={13} className="shrink-0 fill-amber-400 text-amber-500" />}{row.draftId && <span className="shrink-0 text-[11px] font-medium text-crimson">Draft</span>}</span>
            </span>
          </button></MotionIn>
        })}
        {(contextual ? contextQuery.isSuccess && contextFiltered.length === 0 : list.isSuccess && mailSorted.length === 0) && <p className="p-5 text-sm text-muted">{contextual ? 'No linked correspondence is available to your mailbox for these filters.' : 'No messages match this folder and search.'}</p>}
        {contextual && contextQuery.data?.nextCursor != null && <div className="p-3"><Button size="sm" onClick={() => { setMoreContext(items => [...items, ...(contextQuery.data?.items ?? [])]); setCursor(contextQuery.data!.nextCursor!) }}>Load more linked correspondence</Button></div>}
        {!contextual && list.data?.nextPageToken && <div className="p-3"><Button size="sm" onClick={() => { setExtra(items => [...items, ...(list.data?.items ?? [])]); setPageToken(list.data!.nextPageToken!) }}>Load more mail</Button></div>}
      </div>
      <div className="min-w-0 overflow-y-auto">{selected && !(contextual && contextQuery.isError) && !(supervisory && supervisors.isError) ? <ConversationView key={`${selected.mailboxId}:${selected.kind}:${selected.id}:${view}`} email={email} item={selected} entity={contextual || supervisory ? scope : undefined} origin={scope} supervisor={supervisory} unlinked={supervisory && !contextual} capabilities={status.data?.capabilities ?? []} ownMailboxes={ownMailboxes.filter(mailbox => mailbox.status === 'connected')} onCompose={setCompose} onChanged={refresh} /> : <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 p-10 text-center text-muted"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-900/[0.04]"><Icon name="MailOpen" size={26} /></span><p className="text-[14px] font-medium text-ink-700">Select a conversation</p><p className="max-w-xs text-[12.5px]">Messages open here, read live from Gmail.</p></div>}</div>
    </div>
    {compose && <ComposeDialog key={`${compose.mode}:${compose.draftId ?? compose.message?.id ?? 'new'}`} email={email} mailboxes={ownMailboxes.filter(mailbox => mailbox.status === 'connected')} start={compose} onClose={() => setCompose(null)} onSaved={message => { setNotice(message); refresh() }} />}
    {access && <EmailAccessDialog email={email} administrator={status.data?.administrator ?? false} mailboxes={ownMailboxes.filter(mailbox => mailbox.status === 'connected')} entity={scope} onClose={() => setAccess(false)} />}
    {picking && <EmailRecordPicker email={email} onChoose={record => { resetList(); patch({ mailView: 'context', mailEntity: record.type, mailEntityId: record.id }) }} onClose={() => setPicking(false)} />}
  </section>
}
