import { isoToday } from './dates'
import type { SalesPerson } from './types'

/** Substring of the same-day-collision message thrown by the "one open owner
 *  per entity" invariant — identically, by BOTH backends:
 *  - the in-memory repository (`src/data/in-memory/repository.ts`, `assignOwner`)
 *    throws a plain `Error` with this text, no `.code`/`.data` at all;
 *  - a real Postgres-backed server throws a `TRPCError({ code: 'BAD_REQUEST' })`
 *    with the same text, which surfaces client-side as a `TRPCClientError`.
 *  Matching on `.message` (rather than a `.data.code` shape that only the
 *  tRPC error carries) is what makes this work identically for both. */
const SAME_DAY_COLLISION_MESSAGE = 'a replacement must start after that'

function isSameDayCollisionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(SAME_DAY_COLLISION_MESSAGE)
}

/** Resolves a `SalesTeamPicker`-style email to a `SalesPerson.id` and assigns
 *  that person as the entity's owner — but only when doing so would actually
 *  change anything. Designed to be called unconditionally from a form's save
 *  path (Employee, Opportunity) without risking a duplicate assignment or a
 *  blocked save on repeated, unchanged submissions.
 *
 *  Returns `true` if an assignment was made, `false` if skipped (no email
 *  picked, email unresolvable, or already the current owner). Throws only
 *  for a genuine, unexpected error — never for the expected "same owner,
 *  no-op" case, and never for the rare same-day-collision case (swallowed
 *  and logged instead, since it must not block the entity save).
 */
export async function assignOwnerFromEmail(args: {
  entityType: 'contact' | 'opportunity'
  entityId: string
  /** The picked SalesTeamPicker value; null/undefined/empty = no-op. */
  email: string | null | undefined
  /** Caller passes the already-fetched list (avoids a duplicate fetch). */
  salesPersons: SalesPerson[]
  /** The current DIRECT owner's salesPersonId (i.e. `OwnerResolution.source
   *  === 'direct'`), or null/undefined if there is no current direct owner —
   *  including when the only resolution available is `source: 'inherited'`.
   *  This helper is deliberately decoupled from `OwnerResolution`/`useResolvedOwners`:
   *  it is the CALLER's job to collapse an inherited resolution to
   *  null/undefined before calling, not this helper's job to know about that
   *  type. Passing an inherited owner's id here would wrongly skip creating a
   *  real direct assignment. */
  currentOwnerSalesPersonId: string | null | undefined
  assignMutateAsync: (input: {
    entityType: string
    entityId: string
    salesPersonId: string
    role: 'owner'
    startDate: string
    reason: string
  }) => Promise<unknown>
}): Promise<boolean> {
  const { entityType, entityId, email, salesPersons, currentOwnerSalesPersonId, assignMutateAsync } = args

  if (!email) return false

  const salesPersonId = salesPersons.find((p) => p.officialEmail === email)?.id
  if (!salesPersonId) return false

  if (salesPersonId === currentOwnerSalesPersonId) return false

  try {
    await assignMutateAsync({
      entityType,
      entityId,
      salesPersonId,
      role: 'owner',
      startDate: isoToday(),
      reason: 'reassignment',
    })
    return true
  } catch (error) {
    if (isSameDayCollisionError(error)) {
      console.warn(
        `assignOwnerFromEmail: skipped a same-day owner change on ${entityType} ${entityId} ` +
          '(the current owner\'s assignment already starts today or later).',
        error,
      )
      return false
    }
    throw error
  }
}
