import { isBoqPendingApproval } from '@goms/domain'
import type { ActionQueueEntry } from '@/lib/types'
import type { CommercialBoq } from '@/modules/commercial-calculator/types'

/** Pure helpers behind the Home page: what needs attention, and the small formatted bits. Kept free of React so they are
 *  unit-tested directly. */

export type AttentionTone = 'overdue' | 'soon' | 'waiting'
export interface AttentionRow {
  key: string
  tone: AttentionTone
  module: 'Opportunity' | 'Commercial Calculator'
  text: string
  /** ISO date (yyyy-mm-dd) shown on the right; null when the item has no due date. */
  dueDate: string | null
  assigneeId: string | null
  href: string
}

const TONE_ORDER: Record<AttentionTone, number> = { overdue: 0, soon: 1, waiting: 2 }
const DAY_MS = 86_400_000
const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const todayIso = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

/** Everything on the home page's "Needs attention" ledger, most urgent first. Bid follow-ups come from the bid action queue
 *  (overdue / due soon / corrigendum pending); BOQs come from the commercial calculator's approval step. A module the person
 *  cannot read contributes nothing. */
export function attentionRows(
  queue: readonly ActionQueueEntry[],
  boqs: readonly CommercialBoq[],
  today: string,
  allow: { opportunity: boolean; commercial: boolean },
): AttentionRow[] {
  const rows: AttentionRow[] = []
  if (allow.opportunity) {
    for (const entry of queue) {
      if (entry.attentionFlag === 'onTrack') continue
      const what = entry.note.trim() || 'follow-up'
      const late = dayNumber(today) - dayNumber(entry.dueDate)
      const tone: AttentionTone = entry.attentionFlag === 'overdue' ? 'overdue' : entry.attentionFlag === 'dueSoon' ? 'soon' : 'waiting'
      const text = tone === 'waiting'
        ? `${entry.opportunityName}: corrigendum pending`
        : tone === 'overdue' && late > 0
          ? `${entry.opportunityName}: ${what}, ${plural(late, 'day')} overdue`
          : `${entry.opportunityName}: ${what}`
      rows.push({ key: `fu-${entry.followUpId}`, tone, module: 'Opportunity', text, dueDate: entry.dueDate, assigneeId: entry.assigneeId, href: `/bid-tracker/bid/${entry.bidId}` })
    }
  }
  if (allow.commercial) {
    for (const boq of boqs) {
      if (!isBoqPendingApproval(boq.status)) continue
      const label = boq.opportunityName || boq.customerName
      rows.push({ key: `boq-${boq.id}`, tone: 'waiting', module: 'Commercial Calculator', text: `${boq.boqNumber}${label ? ` (${label})` : ''} is waiting for approval`, dueDate: null, assigneeId: null, href: '/commercial-calculator' })
    }
  }
  return rows.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
}

export const attentionSummary = (rows: readonly AttentionRow[]) =>
  (['overdue', 'soon', 'waiting'] as const)
    .map((tone) => [tone, rows.filter((r) => r.tone === tone).length] as const)
    .filter(([, n]) => n > 0)
    .map(([tone, n]) => `${n} ${tone === 'soon' ? 'due soon' : tone}`)
    .join(' · ')

export const greetingFor = (now: Date) => (now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening')

/** "Thursday 16 October" */
export const longDay = (now: Date) => {
  const part = (options: Intl.DateTimeFormatOptions) => now.toLocaleDateString('en-GB', options)
  return `${part({ weekday: 'long' })} ${part({ day: 'numeric' })} ${part({ month: 'long' })}`
}

/** "Tue 14 Oct" for an ISO date. */
export const shortDay = (iso: string) => {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  const part = (options: Intl.DateTimeFormatOptions) => date.toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' })
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })}`
}

export const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase()
}

/** First name for the greeting, from a display name or, failing that, the part of the email before the "@". */
export const firstNameOf = (displayName: string | null | undefined, email: string | null | undefined) => {
  const base = (displayName?.trim() || email?.split('@')[0] || '').trim()
  const word = base.split(/[\s._-]+/).filter(Boolean)[0] ?? ''
  return word ? word[0].toUpperCase() + word.slice(1) : ''
}

/** ₹ amounts in the app are stored in crore. */
export const crore = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')} Cr`
