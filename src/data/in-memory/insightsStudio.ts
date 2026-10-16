// Insights Studio in local (no API) mode: pure functions over the stored arrays, so every change returns new lists and
// the repository swaps them in. The same domain validators as the API router check every write. Local mode has a
// single user (this device), so ownership checks reduce to "the row exists".
import {
  isBuiltInId, normalizeReportInput, normalizeVisualInput,
  type InsightCorrigendumRow, type InsightReport, type InsightReportInput, type InsightVisual, type InsightVisualInput,
} from '@goms/domain'
import type { BidCorrigendum } from '@/lib/types'
import { uid } from '@/lib/utils'

export const LOCAL_STUDIO_OWNER = 'local@this-device'

const byName = <T extends { name: string; createdAt: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.createdAt.localeCompare(b.createdAt)

/** Deep copies so callers can never mutate stored rows (specs and layouts are nested JSON). */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function listVisualsLocal(items: readonly InsightVisual[]): InsightVisual[] {
  return [...items].sort(byName).map(copy)
}

export function createVisualLocal(items: readonly InsightVisual[], input: InsightVisualInput): { items: InsightVisual[]; created: InsightVisual } {
  const clean = normalizeVisualInput(input)
  const now = new Date().toISOString()
  const created: InsightVisual = { id: uid('viz'), ...copy(clean), ownerEmail: LOCAL_STUDIO_OWNER, createdAt: now, updatedAt: now }
  return { items: [...items, created], created: copy(created) }
}

function existing<T extends { id: string }>(items: readonly T[], id: string): T {
  const found = items.find((item) => item.id === id)
  if (!found) throw new Error('That item no longer exists.')
  return found
}

export function updateVisualLocal(items: readonly InsightVisual[], id: string, input: InsightVisualInput): { items: InsightVisual[]; updated: InsightVisual } {
  const before = existing(items, id)
  const updated: InsightVisual = { ...before, ...copy(normalizeVisualInput(input)), updatedAt: new Date().toISOString() }
  return { items: items.map((item) => (item.id === id ? updated : item)), updated: copy(updated) }
}

export function deleteVisualLocal(items: readonly InsightVisual[], id: string): InsightVisual[] {
  existing(items, id)
  return items.filter((item) => item.id !== id)
}

const visualCheck = (visuals: readonly InsightVisual[]) => (id: string) => isBuiltInId(id) || visuals.some((v) => v.id === id)

export function listReportsLocal(items: readonly InsightReport[]): InsightReport[] {
  return [...items].sort(byName).map(copy)
}

export function createReportLocal(items: readonly InsightReport[], visuals: readonly InsightVisual[], input: InsightReportInput): { items: InsightReport[]; created: InsightReport } {
  const clean = normalizeReportInput(input, visualCheck(visuals))
  const now = new Date().toISOString()
  const created: InsightReport = { id: uid('rpt'), ...copy(clean), ownerEmail: LOCAL_STUDIO_OWNER, createdAt: now, updatedAt: now }
  return { items: [...items, created], created: copy(created) }
}

export function updateReportLocal(items: readonly InsightReport[], visuals: readonly InsightVisual[], id: string, input: InsightReportInput): { items: InsightReport[]; updated: InsightReport } {
  const before = existing(items, id)
  const updated: InsightReport = { ...before, ...copy(normalizeReportInput(input, visualCheck(visuals))), updatedAt: new Date().toISOString() }
  return { items: items.map((item) => (item.id === id ? updated : item)), updated: copy(updated) }
}

export function deleteReportLocal(items: readonly InsightReport[], id: string): InsightReport[] {
  existing(items, id)
  return items.filter((item) => item.id !== id)
}

/** The Corrigenda source row for one corrigendum, from the bid and opportunity it belongs to. */
export function corrigendumRowLocal(
  c: BidCorrigendum, bid: { bidCode: string; sheet: string } | undefined, opportunityName: string,
): InsightCorrigendumRow {
  const pending = c.changes.filter((ch) => ch.decision === 'pending').length
  return {
    id: c.id, bidId: c.bidId, bidCode: bid?.bidCode ?? '', sheet: bid?.sheet ?? 'bidTracker', opportunityName,
    corrigendumNumber: c.corrigendumNumber, status: pending ? 'pending_review' : 'reviewed', reviewStatus: c.reviewStatus,
    impactLevel: c.impactLevel, technicalImpact: c.technicalImpact, commercialImpact: c.commercialImpact,
    submissionDateImpact: c.submissionDateImpact, changeCount: c.changes.length, pendingChanges: pending,
    detectedAt: c.detectedAt, publishedDate: c.publishedDate,
  }
}
