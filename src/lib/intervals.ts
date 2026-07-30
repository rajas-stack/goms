import { toLocalIsoDate } from './dates'

/** A half-open date range: `startDate` inclusive, `endDate` EXCLUSIVE.
 *  `endDate: null` means "still current".
 *
 *  Half-open (rather than an inclusive end) makes "no gap, no overlap" the
 *  single comparison `next.startDate === prev.endDate`, and removes the
 *  ±1-day arithmetic that otherwise appears at every handover. The one
 *  place a day is subtracted is `displayEndDate`, for rendering only. */
export interface Interval {
  startDate: string
  endDate: string | null
}

/** ISO date strings sort lexicographically, so plain string comparison is
 *  correct here and avoids constructing a Date per comparison. */
export function coversDate(i: Interval, asOf: string): boolean {
  if (asOf < i.startDate) return false
  return i.endDate === null || asOf < i.endDate
}

export function activeAt<T extends Interval>(rows: T[], asOf: string): T[] {
  return rows.filter((r) => coversDate(r, asOf))
}

/** The single row with no end date, if there is one. Callers that require
 *  at most one open row must enforce that themselves — this returns the
 *  first and is not a validity check. Use `validateContiguity` for that. */
export function openRow<T extends Interval>(rows: T[]): T | undefined {
  return rows.find((r) => r.endDate === null)
}

/** Returns a copy with `endDate` set. Never mutates: interval rows are
 *  stored objects and closing one must not retroactively change what a
 *  caller already read. */
export function closeAt<T extends Interval>(row: T, endDate: string): T {
  if (endDate <= row.startDate) {
    throw new Error(`Interval cannot end on or before its start (start ${row.startDate}, end ${endDate})`)
  }
  return { ...row, endDate }
}

export function sortByStart<T extends Interval>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.startDate.localeCompare(b.startDate))
}

/** Every way a set of intervals for ONE subject can be malformed, as
 *  human-readable strings. Empty array = valid. Used by the repository's
 *  pre-flight checks and by the dev-mode integrity assertions. */
export function validateContiguity(rows: Interval[]): string[] {
  const problems: string[] = []
  const sorted = sortByStart(rows)

  for (const r of sorted) {
    if (r.endDate !== null && r.endDate <= r.startDate) {
      problems.push(`Interval starting ${r.startDate} ends before or on its start (${r.endDate}).`)
    }
  }

  const open = sorted.filter((r) => r.endDate === null)
  if (open.length > 1) {
    problems.push(`Found ${open.length} rows with no end date; more than one open interval is not allowed.`)
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i]
    const next = sorted[i + 1]
    if (prev.endDate === null) {
      problems.push(`Interval starting ${prev.startDate} is open but is followed by one starting ${next.startDate}.`)
      continue
    }
    if (prev.endDate < next.startDate) {
      problems.push(`Gap between ${prev.endDate} and ${next.startDate}.`)
    } else if (prev.endDate > next.startDate) {
      problems.push(`Overlap: interval ending ${prev.endDate} runs past the next start ${next.startDate}.`)
    }
  }

  return problems
}

/** The last day actually covered, for display. Storage is exclusive-end;
 *  humans read "01 Jan – 30 Jun", so a stored end of 2025-07-01 renders as
 *  2025-06-30. Rendering only — never write this back. */
export function displayEndDate(endDate: string | null): string | null {
  if (endDate === null) return null
  const [y, m, d] = endDate.split('-').map(Number)
  // Day 0 of the following month is the last day of the current one, so
  // this is correct across month and year boundaries and in leap years.
  const prev = new Date(y, m - 1, d - 1)
  return toLocalIsoDate(prev)
}
