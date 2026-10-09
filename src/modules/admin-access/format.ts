import { ROLE_LABELS, type Role } from '@goms/domain'

/** A timestamp for the access screens (override set-at, audit history). */
export const formatWhen = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export const roleLabel = (role: string): string => ROLE_LABELS[role as Role] ?? role

/** The server's own message when there is one (tRPC errors carry it), so a refusal reads as the server worded it. */
export const errorMessage = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback)
