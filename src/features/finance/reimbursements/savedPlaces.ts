import { useCallback, useEffect, useState } from 'react'
import { useAuthUser } from '@/lib/auth/useAuthUser'
import type { Place } from './model'

/** A starred place: the user's short name for it ("Home", "Delhi office") and the place itself. */
export interface SavedPlace { short: string; place: Place }

// shortcut: starred places live in this browser's localStorage per signed-in email; move with the claims to the API.
const keyFor = (email: string) => `goms.finance.savedPlaces.v1:${email.toLowerCase()}`
const CHANGED = 'goms:saved-places-changed'
const MAX_SHORT = 40

function load(email: string): SavedPlace[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(keyFor(email)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((s): s is SavedPlace => typeof s?.short === 'string' && typeof s?.place?.name === 'string') : []
  } catch { return [] }
}

const samePlace = (a: Place, b: Place) =>
  (!!a.placeId && a.placeId === b.placeId) || (a.lat != null && a.lat === b.lat && a.lng === b.lng)

/** The starred entry for a place: same Google place or location, or a place already named by its short name. */
export const savedFor = (saved: readonly SavedPlace[], place: Place) =>
  saved.find((s) => samePlace(s.place, place) || s.short.toLowerCase() === place.name.trim().toLowerCase())

/** Starred places matching what was typed (short name, full name or address); all of them when nothing is typed. */
export function matchSaved(saved: readonly SavedPlace[], query: string): SavedPlace[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...saved]
  return saved.filter((s) => [s.short, s.place.name, s.place.address ?? ''].some((t) => t.toLowerCase().includes(q)))
}

/** Adds or renames a starred place; one entry per place and per short name. */
export function withStar(saved: readonly SavedPlace[], short: string, place: Place): SavedPlace[] {
  const name = short.trim().slice(0, MAX_SHORT)
  if (!name) return [...saved]
  const rest = saved.filter((s) => !samePlace(s.place, place) && s.short.toLowerCase() !== name.toLowerCase())
  return [...rest, { short: name, place: { ...place, name: place.name.trim() || name } }].sort((a, b) => a.short.localeCompare(b.short))
}

export function useSavedPlaces() {
  const { user } = useAuthUser()
  const email = user?.email ?? 'local'
  const [saved, setSaved] = useState(() => load(email))
  useEffect(() => {
    setSaved(load(email))
    const refresh = () => setSaved(load(email))
    window.addEventListener(CHANGED, refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener(CHANGED, refresh); window.removeEventListener('storage', refresh) }
  }, [email])

  const write = useCallback((next: SavedPlace[]) => {
    setSaved(next)
    try { localStorage.setItem(keyFor(email), JSON.stringify(next)); window.dispatchEvent(new Event(CHANGED)) } catch { /* storage blocked: stays for this tab */ }
  }, [email])
  const star = useCallback((short: string, place: Place) => write(withStar(load(email), short, place)), [email, write])
  const unstar = useCallback((short: string) => write(load(email).filter((s) => s.short !== short)), [email, write])
  return { saved, star, unstar }
}
