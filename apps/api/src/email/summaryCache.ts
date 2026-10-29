import type { EmailSummary } from '@goms/domain'

/** Inbox summaries by Gmail thread version. Gmail bumps a thread's `historyId` on any change (new mail, read/unread, star,
 *  labels), so an entry is reused only while the thread is byte-for-byte the same. Keyed by mailbox and credential revision,
 *  so a reconnect or another mailbox never sees it. Callers still authorize the mailbox before using an entry.
 *  shortcut: per API process and in memory (lost on restart, not shared across replicas); move to Redis if the API scales out. */
const MAX_ENTRIES = 5000
const entries = new Map<string, { historyId: string; summary: EmailSummary }>()

const keyOf = (mailbox: { id: string; credential_revision: string }, threadId: string) => `${mailbox.id}:${mailbox.credential_revision}:${threadId}`

export function cachedSummary(mailbox: { id: string; credential_revision: string }, threadId: string, historyId: string | undefined): EmailSummary | undefined {
  if (!historyId) return undefined
  const key = keyOf(mailbox, threadId), hit = entries.get(key)
  if (!hit || hit.historyId !== historyId) return undefined
  entries.delete(key); entries.set(key, hit) // most recently used goes last
  return hit.summary
}

export function rememberSummary(mailbox: { id: string; credential_revision: string }, threadId: string, historyId: string | undefined, summary: EmailSummary) {
  if (!historyId) return
  const key = keyOf(mailbox, threadId)
  entries.delete(key); entries.set(key, { historyId, summary })
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!)
}

export const clearSummaryCache = () => entries.clear()
