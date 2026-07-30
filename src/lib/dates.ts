/** ISO `YYYY-MM-DD` from a Date's LOCAL calendar fields.
 *
 *  Deliberately not `toISOString().slice(0, 10)`, which converts to UTC
 *  first: in IST (UTC+5:30) that returns the previous day for any local
 *  time before 05:30. Every date in this app is a calendar date the user
 *  typed or expects to see — never an instant — so local fields are the
 *  correct reading. */
export function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** ISO date for "today", in the user's local timezone. */
export function isoToday(): string {
  return toLocalIsoDate(new Date())
}
