import { useSyncExternalStore } from 'react'
import type { Role } from '@goms/domain'

/** The "view as one of my roles" selection. It only NARROWS what this app shows: the roles themselves always come from the
 *  server (`auth.me`), and the server keeps authorising every request with the user's full role set. This is a convenience,
 *  not a security boundary. Stored per user in this browser. */
const KEY_PREFIX = 'goms.activeRole:'
const key = (email: string) => KEY_PREFIX + email.trim().toLowerCase()

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export function readStoredRole(email: string): string | null {
  try {
    return localStorage.getItem(key(email))
  } catch {
    return null
  }
}

export function writeStoredRole(email: string, role: Role | null): void {
  try {
    if (role === null) localStorage.removeItem(key(email))
    else localStorage.setItem(key(email), role)
  } catch {
    // Storage blocked (private window, site data cleared): the choice simply is not remembered.
  }
  notify()
}

/** A saved role counts only while the server still reports it AND there is a real choice (2+ roles). Anything else — a role the
 *  user lost, a tampered value, a single-role user — means "All my roles". */
export function resolveActiveRole(saved: string | null, roles: readonly Role[]): Role | null {
  if (saved === null || roles.length < 2) return null
  return (roles as readonly string[]).includes(saved) ? (saved as Role) : null
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  window.addEventListener('storage', cb) // another tab changed the selection
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

/** The raw saved value for `email` (not yet validated against the server's roles — use `resolveActiveRole`). */
export function useStoredRole(email: string): string | null {
  return useSyncExternalStore(subscribe, () => readStoredRole(email), () => null)
}
