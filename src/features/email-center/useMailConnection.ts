import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/** How often Email Center checks that GOMS (and through it Gmail) can be reached. */
export const CONNECTION_CHECK_MS = 30_000

/** True for a request that never reached the server (offline, DNS, server down), as opposed to an answer it gave. */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|ECONNREFUSED|ERR_NETWORK|502|503|504|bad gateway|gateway timeout/i.test(message)
}

/** Watches the connection: the browser's online/offline events plus a health check every 30 s. While offline the
 *  mail already on screen stays; when the connection returns, everything under `['emailCenter', email]` refetches. */
export function useMailConnection(email: string): { online: boolean } {
  const qc = useQueryClient()
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false)
  const wasOnline = useRef(online)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      if (navigator.onLine === false) { if (!cancelled) setOnline(false); return }
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/trpc/health.check`, { cache: 'no-store' })
        if (!cancelled) setOnline(res.ok)
      } catch {
        if (!cancelled) setOnline(false)
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), CONNECTION_CHECK_MS)
    const goOnline = () => void check()
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline) }
  }, [])

  useEffect(() => {
    if (online && !wasOnline.current) void qc.invalidateQueries({ queryKey: ['emailCenter', email] })
    wasOnline.current = online
  }, [online, email, qc])

  return { online }
}
