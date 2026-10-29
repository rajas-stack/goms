import { useCallback, useEffect, useState } from 'react'
import { useAuthUser } from '@/lib/auth/useAuthUser'
import { emptyClaim, type Claim } from './model'

// shortcut: claims live in this browser's localStorage per signed-in email; replace load/save with the reimbursements API
// (owner-scoped table) so the master record survives other browsers and devices. The UI only uses useClaims().
const keyFor = (email: string) => `goms.finance.reimbursements.v1:${email.toLowerCase()}`
const CHANGED = 'goms:reimbursements-changed'

function load(email: string): Record<string, Claim> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(keyFor(email)) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed as Record<string, Claim>)
      .filter(([month, c]) => /^\d{4}-\d{2}$/.test(month) && Array.isArray(c?.expenses)))
  } catch { return {} }
}

function save(email: string, claims: Record<string, Claim>): boolean {
  try {
    localStorage.setItem(keyFor(email), JSON.stringify(claims))
    window.dispatchEvent(new Event(CHANGED))
    return true
  } catch { return false }
}

/** Every month's claim for the signed-in user, and a writer for one month. */
export function useClaims() {
  const { user } = useAuthUser()
  const email = user?.email ?? 'local'
  const [claims, setClaims] = useState(() => load(email))
  useEffect(() => {
    setClaims(load(email))
    const refresh = () => setClaims(load(email))
    window.addEventListener(CHANGED, refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener(CHANGED, refresh); window.removeEventListener('storage', refresh) }
  }, [email])

  const claimFor = useCallback((month: string) => claims[month] ?? emptyClaim(month), [claims])
  /** Returns false when the browser refused to store it (the change still shows until reload). */
  const putClaim = useCallback((claim: Claim) => {
    const next = { ...load(email), [claim.month]: claim }
    setClaims(next)
    return save(email, next)
  }, [email])

  return { claims, claimFor, putClaim }
}
