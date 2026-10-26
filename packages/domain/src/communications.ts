/** Communication classifications are workflow states, not editable organisation masters. */
export const COMMUNICATION_PARTIES = ['internal', 'delivery', 'oem', 'client', 'clientDepartment', 'external', 'unknown', 'competitor', 'consortium'] as const
export type CommunicationParty = typeof COMMUNICATION_PARTIES[number]
export const COMMUNICATION_PARTY_LABELS: Record<CommunicationParty, string> = {
  internal: 'Internal team', delivery: 'Delivery team', oem: 'OEM', client: 'Client contact',
  clientDepartment: 'Client department mailbox', external: 'Other external', unknown: 'Needs classification',
  competitor: 'Competitor', consortium: 'Consortium partner',
}
export interface MailParticipant { email: string; name: string }
export interface CommunicationMessage {
  id: string; date: string; from: MailParticipant[]; to: MailParticipant[]; cc: MailParticipant[]; sent: boolean
}
export interface CommunicationThread {
  id: string; subject: string; messages: CommunicationMessage[]; updatedAt: string
}
export interface CommunicationContact extends MailParticipant {
  id: string; party: CommunicationParty; organization: string; departmentId: string | null
}
/** The categories an address-book contact (communication_contacts.party) may carry. */
export const CONTACT_PARTIES = ['delivery', 'oem', 'clientDepartment', 'external', 'competitor', 'consortium'] as const
export type ContactParty = typeof CONTACT_PARTIES[number]
export interface CommunicationPerson extends MailParticipant {
  id: string; source: 'org' | 'delivery' | 'sales' | 'client' | 'contact'; party: CommunicationParty
}
export interface LinkedCommunicationThread {
  thread: CommunicationThread; category: CommunicationParty | null; linkedAt: string
}
export interface BidCommunicationState { threads: LinkedCommunicationThread[]; ignored: string[] }
export const normalizeMailAddress = (value: string) => value.trim().toLowerCase()
export const validMailAddress = (value: string) => /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(value) && value.length <= 254

function displayName(value: string): string {
  return value.replace(/(\?=)\s+(=\?)/g, '$1$2').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (original, charset: string, encoding: string, text: string) => {
    try {
      const binary = encoding.toLowerCase() === 'b' ? atob(text) : text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      return new TextDecoder(charset).decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
    } catch { return original }
  }).trim().replace(/^"|"$/g, '').replace(/\\"/g, '"').slice(0, 200)
}

/** Split RFC-style mailbox lists outside quoted display names/angle addresses. Malformed tokens are skipped, never guessed. */
export function parseMailParticipants(value: string): MailParticipant[] {
  const chunks: string[] = []; let chunk = ''; let quoted = false; let angled = false; let escaped = false
  for (const char of value) {
    if (!escaped && char === '"') quoted = !quoted
    if (!quoted && char === '<') angled = true
    if (!quoted && char === '>') angled = false
    if (!quoted && !angled && (char === ',' || char === ';')) { chunks.push(chunk); chunk = '' } else chunk += char
    escaped = !escaped && char === '\\'
  }
  chunks.push(chunk)
  const result = new Map<string, MailParticipant>()
  for (const raw of chunks) {
    const match = raw.trim().match(/^(.*?)<([^<>]+)>\s*$/)
    const email = normalizeMailAddress(match ? match[2] : raw)
    if (!validMailAddress(email)) continue
    const name = match ? displayName(match[1]) : ''
    if (!result.has(email) || name) result.set(email, { email, name: name.slice(0, 200) })
  }
  return [...result.values()]
}
export function threadParticipants(thread: CommunicationThread): MailParticipant[] {
  const found = new Map<string, MailParticipant>()
  for (const message of thread.messages) for (const person of [...message.from, ...message.to, ...message.cc]) {
    const email = normalizeMailAddress(person.email)
    if (!found.has(email) || !found.get(email)!.name) found.set(email, { ...person, email })
  }
  return [...found.values()]
}
export function matchMailParticipant(person: MailParticipant, directory: CommunicationPerson[]) {
  const exact = directory.filter(item => item.email && normalizeMailAddress(item.email) === normalizeMailAddress(person.email))
  // Name-only matches are suggestions; they never identify or modify a person automatically.
  const name = person.name.trim().toLowerCase().replace(/\s+/g, ' ')
  const suggestions = name ? directory.filter(item => !item.email && item.name.trim().toLowerCase().replace(/\s+/g, ' ') === name) : []
  return { exact, suggestions }
}
export function categorizeThread(thread: CommunicationThread, directory: CommunicationPerson[], mailbox: string): CommunicationParty[] {
  const categories = new Set<CommunicationParty>()
  for (const person of threadParticipants(thread)) {
    if (normalizeMailAddress(person.email) === normalizeMailAddress(mailbox)) continue
    const matches = matchMailParticipant(person, directory).exact
    if (!matches.length) { categories.add('unknown'); continue }
    for (const item of matches) categories.add(item.party)
  }
  return categories.size ? [...categories] : threadParticipants(thread).length ? ['internal'] : ['unknown']
}
/** Quote bid identity literally so punctuation cannot inject Gmail search operators. */
export function communicationSearch(values: (string | null | undefined)[]): string {
  const terms = [...new Set(values.map(value => value?.trim()).filter((value): value is string => !!value))]
    .map(value => `"${value.replace(/["\\\r\n]/g, ' ')}"`)
  return terms.length ? `{${terms.join(' ')}} -in:spam -in:trash -is:draft` : ''
}
