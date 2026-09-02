import type { AttendeeRef } from './types'

/** Display name for an attendee — a legacy plain string *is* the name; the
 *  new ID-carrying snapshot keeps it in `.name`. */
export function attendeeName(a: AttendeeRef): string {
  return typeof a === 'string' ? a : a.name
}

/** The sales person's id, when known. `undefined` for a legacy plain-string
 *  attendee — there's nothing to resolve a photo/profile from. */
export function attendeeSalesPersonId(a: AttendeeRef): string | undefined {
  return typeof a === 'string' ? undefined : a.salesPersonId
}
