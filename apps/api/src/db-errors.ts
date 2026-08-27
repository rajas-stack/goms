// Shared Postgres error-code guards, used across routers to translate a raw
// driver error into a friendly TRPCError instead of letting it bubble up
// unhandled (see the 2026-08-26 backend hardening pass). Extracted from
// commercial.ts, which previously defined `isForeignKeyViolation` locally —
// hierarchy.ts and sales.ts need the identical check for their own
// unhandled-RESTRICT-violation gaps, so it lives here once instead of being
// copy-pasted per router.

/** A DELETE/UPDATE was rejected because another row still references this
 *  one via a foreign key with the default (or explicit) RESTRICT behavior. */
export function isForeignKeyViolation(e: unknown): e is { code: '23503'; detail?: string } {
  return typeof e === 'object' && e !== null && (e as any).code === '23503'
}

/** An INSERT/UPDATE was rejected by a UNIQUE constraint/index — the losing
 *  side of a race whose app-level pre-check (a plain SELECT, not itself
 *  atomic) passed but was overtaken by a concurrent request before this
 *  statement committed. */
export function isUniqueViolation(e: unknown): e is { code: '23505'; detail?: string } {
  return typeof e === 'object' && e !== null && (e as any).code === '23505'
}
