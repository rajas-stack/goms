/** WhatsApp through the self-hosted OpenWA gateway (../OpenWA), reached via the Vite proxy `/openwa`, which adds the API key in
 *  Node (vite.config.ts). Each GOMS user links their own number as their own OpenWA session.
 *  shortcut: dev-server proxy only (localhost:5173); move these calls behind an apps/api route before GOMS runs on its server. */

import { readStarred } from './starredMessages'

export type WhatsAppStatus = 'created' | 'initializing' | 'qr_ready' | 'authenticating' | 'ready' | 'disconnected' | 'action_required' | 'failed'
export interface WhatsAppSession { id: string; name: string; status: WhatsAppStatus; phone?: string | null; pushName?: string | null; lastError?: string | null }
export interface WhatsAppChat { id: string; name: string; isGroup: boolean; unreadCount: number; timestamp: number; lastMessage?: string }
export interface WhatsAppContact { id: string; name?: string; pushName?: string; number?: string; isGroup?: boolean; isBlocked?: boolean }
export interface WhatsAppGroupInfo { id: string; name: string; description?: string; participants: { id: string; number: string; name?: string; isAdmin: boolean }[] }
/** An attachment. `data` is base64; it is missing (`omitted`) when the file is over the size cap or WhatsApp can no longer serve it. */
export interface WhatsAppMedia { mimetype: string; filename?: string; data?: string; omitted?: boolean; sizeBytes?: number }
export interface WhatsAppLocation { latitude: number; longitude: number; description?: string; address?: string; url?: string }
export interface WhatsAppMessage {
  id: string; body: string; type: string; timestamp: number; fromMe: boolean; author?: string
  media?: WhatsAppMedia; location?: WhatsAppLocation; quotedMessage?: { id: string; body: string }
  /** The sender as WhatsApp knows them. `author` may be a privacy id (…@lid), not a phone; `senderPhone` is the real one when known. */
  contact?: { name?: string; pushName?: string }; senderPhone?: string | null; mentionedIds?: Array<string | { _serialized: string }>
  /** Set by this page after acting on the message (WhatsApp's history does not report them). */
  myReaction?: string; starred?: boolean; pinned?: boolean
}
/** Files up to this size are kept with a message filed to an opportunity; bigger ones stay in WhatsApp. */
export const KEEP_FILE_BYTES = 25 * 1024 * 1024

/** ITU country calling codes. They are prefix-free (no code begins another), so the first match on 1, 2 or 3 digits is the code. */
const CALLING_CODES = new Set(('1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 '
  + '90 91 92 93 94 95 98 211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 '
  + '244 245 246 247 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 290 291 297 298 299 350 351 352 353 354 '
  + '355 356 357 358 359 370 371 372 373 374 375 376 377 378 380 381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505 506 507 508 509 '
  + '590 591 592 593 594 595 596 597 598 599 670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 800 808 850 852 '
  + '853 855 856 870 878 880 881 882 883 886 888 960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 979 992 993 994 995 996 998').split(' '))

/** "917358769276" → "+91 73587 69276": the country code, then the number grouped as WhatsApp shows it (India 5-5, +1 3-3-4, else threes). */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  const code = [1, 2, 3].map((length) => digits.slice(0, length)).find((prefix) => CALLING_CODES.has(prefix))
  if (!code || digits.length < 8 || digits.length > 15) return `+${digits}`
  const national = digits.slice(code.length)
  if (code === '91' && national.length === 10) return `+91 ${national.slice(0, 5)} ${national.slice(5)}`
  if (code === '1' && national.length === 10) return `+1 ${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`
  const groups = national.match(/\d{1,3}/g) ?? []
  if (groups.length > 1 && groups[groups.length - 1].length === 1) groups.splice(-2, 2, groups[groups.length - 2] + groups[groups.length - 1])
  return `+${code} ${groups.join(' ')}`
}
/** A chat or sender id as a phone. A privacy id (…@lid) is not a phone number, so its digits stay unformatted. */
export const chatPhone = (id: string) => (id.endsWith('@lid') ? `+${id.split('@')[0]}` : formatPhone(id.split('@')[0]))

/** Who a WhatsApp id is, from the gateway's contacts: a name, and the real phone (a …@lid privacy id resolves when WhatsApp can).
 *  Best effort: unknowns come back null, never an error. */
export async function whoIs(sessionId: string, contactId: string): Promise<{ name: string | null; phone: string | null }> {
  const id = encodeURIComponent(contactId)
  const [contact, phone] = await Promise.allSettled([
    call<{ name?: string; pushName?: string; number?: string }>(`/sessions/${sessionId}/contacts/${id}`),
    contactId.endsWith('@lid') ? call<{ phone?: string | null }>(`/sessions/${sessionId}/contacts/${id}/phone`) : Promise.resolve({ phone: contactId.split('@')[0] }),
  ])
  const found = contact.status === 'fulfilled' ? contact.value : undefined
  return {
    name: found?.name || found?.pushName || null,
    phone: (phone.status === 'fulfilled' && phone.value.phone) || (contactId.endsWith('@c.us') ? found?.number ?? null : null),
  }
}

/** The ids a message mentions ("…@lid"). WhatsApp Web hands them over as id objects, not strings. */
export const mentionIdsOf = (message: WhatsAppMessage): string[] =>
  (message.mentionedIds ?? []).map((id) => (typeof id === 'string' ? id : id._serialized)).filter(Boolean)

/** "@102404972400823" → "@Name" with the names found so far (by the id's digits); unknown ones stay as they are. */
export const withMentionNames = (body: string, names: Map<string, string>) =>
  body.replace(/@(\d{6,})/g, (mention, digits: string) => (names.has(digits) ? `@${names.get(digits)}` : mention))

/** "@102404972400823" in a message is a mention by id; WhatsApp shows the person's name. Ids we cannot name stay as they are. */
export async function nameMentions(sessionId: string, body: string, ids: string[]): Promise<string> {
  let named = body
  for (const id of ids) {
    const digits = id.split('@')[0]
    if (!named.includes(`@${digits}`)) continue
    const { name, phone } = await whoIs(sessionId, id)
    if (name || phone) named = named.split(`@${digits}`).join(`@${name ?? formatPhone(phone ?? "")}`)
  }
  return named
}

/** WhatsApp's pin lengths. */
export const PIN_DURATIONS = [{ seconds: 86_400, label: '24 hours' }, { seconds: 604_800, label: '7 days' }, { seconds: 2_592_000, label: '30 days' }] as const
/** Message types that carry a file. */
export const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'voice', 'document', 'sticker'])

/** Where WhatsApp works: Vite's dev or local preview server (both run the gateway proxy) with local data (filed messages live in
 *  this browser). Port 5173 serves the `local-preview` build. */
export const whatsappAvailable = () =>
  (import.meta.env.DEV || import.meta.env.MODE === 'local-preview') && !import.meta.env.VITE_API_BASE_URL

/** Builds without sign-in (local mode on 5173) are one person on one computer, which links one WhatsApp. */
export const LOCAL_SESSION = 'goms-this-computer'

/** OpenWA session names allow letters, digits and hyphens (3-50 chars). The readable part alone can collide (john.doe / john_doe),
 *  so a hash of the whole email keeps every user on their own WhatsApp link. */
export function sessionName(email: string): string {
  const normalized = email.trim().toLowerCase()
  let hash = 0x811c9dc5 // FNV-1a, 32-bit
  for (const char of normalized) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
  return `goms-${normalized.split('@')[0].replace(/[^a-z0-9]+/g, '-').slice(0, 36)}-${hash.toString(36)}`
}

/** `retryAfterMs`: how long the gateway's rate limiter asked us to wait (429 only). */
export class WhatsAppError extends Error { constructor(message: string, readonly status: number, readonly retryAfterMs?: number) { super(message) } }

/** The gateway has several limiters (per second, minute, hour…) and sends a Retry-After header for each; the longest is the one that applies. */
const retryAfterMs = (headers: Headers) => {
  const seconds = [...headers].filter(([name]) => name.toLowerCase().startsWith('retry-after')).map(([, value]) => Number(value)).filter(Number.isFinite)
  return seconds.length ? Math.max(...seconds) * 1000 : undefined
}

/** WhatsApp Web can stall right after linking (first sync); a request never waits longer than this. */
const TIMEOUT_MS = 60_000
/** Measured: the first chat list after a fresh link took 78 s (0.5 s once the sync settles). */
const CHATS_TIMEOUT_MS = 180_000
/** Attachments download one by one through WhatsApp Web: measured 27 s for a chat with 11. */
const MEDIA_TIMEOUT_MS = 180_000
const GATEWAY_DOWN = 'The WhatsApp gateway is not running or failed. Start it in E:\\goms\\OpenWA with docker compose.'

interface CallOptions { method?: string; json?: object; body?: BodyInit; timeoutMs?: number; headers?: Record<string, string> }

/** Fetch with a time limit; a non-OK answer throws its JSON `message`, or `down` when the service did not answer in JSON. */
async function request(url: string, { method = 'GET', json, body, timeoutMs = TIMEOUT_MS, headers }: CallOptions, down: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, {
      method, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
      headers: { ...(json && { 'Content-Type': 'application/json' }), ...headers },
      body: json ? JSON.stringify(json) : body,
    })
  } catch (error) {
    if ((error as Error).name === 'TimeoutError') throw new WhatsAppError('WhatsApp is taking too long to answer. It may still be syncing after linking; press Refresh in a moment.', 0)
    throw new WhatsAppError(down, 0)
  }
  if (res.status === 401) throw new WhatsAppError('The WhatsApp gateway rejected GOMS: set OPENWA_API_KEY in .env.local and restart the dev server.', 401)
  if (res.status === 429) throw new WhatsAppError('WhatsApp is busy (too many requests). Wait a moment and try again.', 429, retryAfterMs(res.headers))
  if (!res.ok) {
    const failure = await res.json().catch(() => null)
    throw new WhatsAppError(failure?.message ? String(failure.message) : `${down} (HTTP ${res.status})`, res.status)
  }
  return res
}

/** WhatsApp Web answers slowly or drops reads while it syncs or reconnects; such a read is tried again for up to this long. */
const READ_RETRY_MS = 45_000
/** Passing failures only: no answer, timeouts, engine not ready yet (409), throttling and server errors. A 404 or 401 fails at once. */
const isTransient = (error: unknown) => error instanceof WhatsAppError && (error.status === 0 || [408, 409, 425, 429].includes(error.status) || error.status >= 500)

/** Retries an idempotent read with growing waits (1, 2, 4, 8, 8… s), or as long as a rate limit asks, until it succeeds or the next
 *  wait would pass the budget. */
export async function retryRead<T>(read: () => Promise<T>, budgetMs = READ_RETRY_MS, sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<T> {
  const deadline = Date.now() + budgetMs
  for (let attempt = 0; ; attempt++) {
    try { return await read() } catch (error) {
      const wait = Math.max(Math.min(1000 * 2 ** attempt, 8000), (error as WhatsAppError).retryAfterMs ?? 0)
      if (!isTransient(error) || Date.now() + wait > deadline) throw error
      await sleep(wait)
    }
  }
}

/** A file can wait behind a rate limit (the gateway's minute window) and still load: no item is left out for being late in the queue. */
const MEDIA_RETRY_MS = 3 * 60_000
let mediaTail: Promise<unknown> = Promise.resolve()
/** Media downloads run one at a time, in the order asked: WhatsApp Web fetches each file from the phone, and bursts trip the gateway's rate limit. */
export function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = mediaTail.then(work, work)
  mediaTail = run.catch(() => {})
  return run
}

const call = async <T>(path: string, options: CallOptions = {}): Promise<T> => (await request(`/openwa/api${path}`, options, GATEWAY_DOWN)).json() as Promise<T>
const chatPath = (id: string, chatId: string) => `/sessions/${id}/messages/${encodeURIComponent(chatId)}`

export const whatsappApi = {
  find: async (name: string) => (await call<WhatsAppSession[]>(`/sessions?name=${encodeURIComponent(name)}`))[0] ?? null,
  /** Creates the user's session on first use, then starts it so WhatsApp issues a QR code. */
  connect: async (name: string, existing: WhatsAppSession | null) => {
    const session = existing ?? await call<WhatsAppSession>('/sessions', { method: 'POST', json: { name } })
    // 409: already starting or started, which is what we want.
    await call(`/sessions/${session.id}/start`, { method: 'POST' }).catch((error: unknown) => { if ((error as WhatsAppError).status !== 409) throw error })
  },
  /** Profile photo URLs (WhatsApp's CDN; signed links that expire) for up to 50 chats per call; null when there is none or it is hidden. */
  pictures: async (id: string, ids: string[]) =>
    (await call<{ pictures: Record<string, string | null> }>(`/sessions/${id}/contacts/profile-pictures?ids=${ids.map(encodeURIComponent).join(',')}`)).pictures,
  qr: (id: string) => call<{ qrCode: string; status: WhatsAppStatus }>(`/sessions/${id}/qr`),
  chats: (id: string) => call<WhatsAppChat[]>(`/sessions/${id}/chats?limit=100`, { timeoutMs: CHATS_TIMEOUT_MS }),
  contacts: (id: string) => call<WhatsAppContact[]>(`/sessions/${id}/contacts?limit=1000`),
  checkNumber: (id: string, number: string) =>
    call<{ exists: boolean; whatsappId: string | null }>(`/sessions/${id}/contacts/check/${encodeURIComponent(number)}`),
  createGroup: (id: string, name: string, participants: string[]) =>
    call<{ id: string; name?: string }>(`/sessions/${id}/groups`, { method: 'POST', json: { name, participants } }),
  history: async (id: string, chatId: string, limit = 50) => {
    const messages = await retryRead(() => call<WhatsAppMessage[]>(`${chatPath(id, chatId)}/history?limit=${limit}`))
    const stars = new Set(readStarred(id).filter((item) => item.chat.id === chatId).map((item) => item.message.id))
    return messages.map((message) => stars.has(message.id) ? { ...message, starred: true } : message)
  },
  /** The same 50 messages with their attachments' files (WhatsApp Web keeps no per-message download), by message id. */
  attachments: async (id: string, chatId: string) => new Map(
    (await oneAtATime(() => retryRead(() => call<WhatsAppMessage[]>(`${chatPath(id, chatId)}/history?limit=50&includeMedia=true`, { timeoutMs: MEDIA_TIMEOUT_MS }), MEDIA_RETRY_MS)))
      .filter((message) => message.media).map((message) => [message.id, message.media!] as const),
  ),
  /** A file the gateway saved to disk (every attachment received or sent since archiving was switched on). */
  storedFile: (id: string, chatId: string, messageId: string) => oneAtATime(() => retryRead(async () =>
    (await request(`/openwa/api${chatPath(id, chatId)}/${encodeURIComponent(messageId)}/media`, { timeoutMs: MEDIA_TIMEOUT_MS }, GATEWAY_DOWN)).blob(), MEDIA_RETRY_MS)),
  /** Word/Excel/PowerPoint (and other office formats) to PDF, by the local LibreOffice converter (Vite proxy /doc-preview). */
  toPdf: async (file: Blob, filename: string) => {
    const form = new FormData()
    form.append('files', file, filename)
    const down = 'The document preview service is not running. Start it in E:\\goms\\OpenWA with docker compose.'
    return (await request('/doc-preview/forms/libreoffice/convert', { method: 'POST', body: form, timeoutMs: 120_000 }, down)).blob()
  },
  /** The same idempotency key for a retried send makes the gateway replay the first result instead of sending twice (24 h).
   *  `quotedMessageId` makes it a reply. */
  send: (id: string, chatId: string, text: string, idempotencyKey: string, quotedMessageId?: string) =>
    call<{ messageId: string; timestamp: number }>(`/sessions/${id}/messages/send-text`,
      { method: 'POST', json: { chatId, text, ...(quotedMessageId && { quotedMessageId }) }, headers: { 'Idempotency-Key': idempotencyKey } }),
  /** The phone's own chat lists (Sales, CXO…) with their chats. WhatsApp's built-in filters (Unread, Groups…) come back with no
   *  chats and are left out, as is a list nobody has added a chat to yet. */
  lists: async (id: string) => {
    const labels = await call<{ id: string; name: string }[]>(`/sessions/${id}/labels`)
    const lists = await Promise.all(labels.map(async (label) => ({
      name: label.name,
      chatIds: (await call<{ id: string }[]>(`/sessions/${id}/labels/${encodeURIComponent(label.id)}/chats`)).map((chat) => chat.id),
    })))
    return lists.filter((list) => list.chatIds.length > 0)
  },
  contact: (id: string, contactId: string) => call<WhatsAppContact>(`/sessions/${id}/contacts/${encodeURIComponent(contactId)}`),
  groupInfo: (id: string, groupId: string) => call<WhatsAppGroupInfo>(`/sessions/${id}/groups/${encodeURIComponent(groupId)}`),
  /** Every group the account is in, with its members (for "groups in common"), five roster reads at a time; a group that fails is left out.
   *  shortcut: one roster query per group, as the gateway's group list drops members; add a participant filter to OpenWA if big accounts get throttled. */
  groupRosters: async (id: string) => {
    const groups = await call<{ id: string }[]>(`/sessions/${id}/groups`)
    const rosters: WhatsAppGroupInfo[] = []
    for (let start = 0; start < groups.length; start += 5) {
      const batch = await Promise.allSettled(groups.slice(start, start + 5).map((group) => call<WhatsAppGroupInfo>(`/sessions/${id}/groups/${encodeURIComponent(group.id)}`)))
      for (const result of batch) if (result.status === 'fulfilled') rosters.push(result.value)
    }
    return rosters
  },
  /** `muteUntil` is epoch milliseconds; null unmutes. */
  mute: (id: string, chatId: string, muteUntil: number | null) => call(`/sessions/${id}/chats/mute`, { method: 'POST', json: { chatId, muteUntil } }),
  block: (id: string, contactId: string, block: boolean) => call(`/sessions/${id}/contacts/${encodeURIComponent(contactId)}/block`, { method: block ? 'POST' : 'DELETE' }),
  deleteChat: (id: string, chatId: string) => call(`/sessions/${id}/chats/delete`, { method: 'POST', json: { chatId } }),
  markRead: (id: string, chatId: string) => call(`/sessions/${id}/chats/read`, { method: 'POST', json: { chatId } }),
  /** An empty emoji removes the reaction. */
  react: (id: string, chatId: string, messageId: string, emoji: string) => call(`/sessions/${id}/messages/react`, { method: 'POST', json: { chatId, messageId, emoji } }),
  forward: (id: string, fromChatId: string, toChatId: string, messageId: string) =>
    call<{ messageId: string; timestamp: number }>(`/sessions/${id}/messages/forward`, { method: 'POST', json: { fromChatId, toChatId, messageId } }),
  pin: (id: string, chatId: string, messageId: string, durationSeconds: number) => call(`/sessions/${id}/messages/pin`, { method: 'POST', json: { chatId, messageId, durationSeconds } }),
  unpin: (id: string, chatId: string, messageId: string) => call(`/sessions/${id}/messages/unpin`, { method: 'POST', json: { chatId, messageId } }),
  star: (id: string, chatId: string, messageId: string, star: boolean) => call(`/sessions/${id}/messages/star`, { method: 'POST', json: { chatId, messageId, star } }),
  remove: (id: string, chatId: string, messageId: string, forEveryone: boolean) => call(`/sessions/${id}/messages/delete`, { method: 'POST', json: { chatId, messageId, forEveryone } }),
  logout: (id: string) => call<unknown>(`/sessions/${id}/logout`, { method: 'POST' }),
}
