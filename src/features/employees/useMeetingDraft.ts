import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const PREFIX = 'gorms:meeting-draft:'
const MAX_AGE = 30 * 24 * 60 * 60 * 1000

/** Small meeting drafts are written synchronously after each change, without a debounce. */
export function useMeetingDraft<T>(key: string | null, value: T, open: boolean) {
  const [restored, setRestored] = useState(false)
  const [error, setError] = useState(false)
  const live = useRef({ key, value, open })
  live.current = { key, value, open }
  const ready = useRef(false)
  const readyKey = useRef<string | null>(null)
  const baseline = useRef('')
  const cleared = useRef(false)
  const flush = useCallback(() => {
    const current = live.current
    if (!current.key || current.key !== readyKey.current || !current.open || !ready.current || cleared.current) return
    const json = JSON.stringify(current.value)
    try {
      if (json === baseline.current) localStorage.removeItem(PREFIX + current.key)
      else localStorage.setItem(PREFIX + current.key, JSON.stringify({ savedAt: Date.now(), value: current.value }))
      setError(false)
    } catch { setError(true) }
  }, [])
  const take = useCallback((seed: T): T | null => {
    ready.current = true
    readyKey.current = live.current.key
    cleared.current = false
    baseline.current = JSON.stringify(seed)
    setRestored(false)
    if (!live.current.key) return null
    try {
      const raw = localStorage.getItem(PREFIX + live.current.key)
      if (!raw) return null
      const stored = JSON.parse(raw)
      if (!stored || typeof stored.savedAt !== 'number' || !stored.value || Date.now() - stored.savedAt > MAX_AGE) {
        localStorage.removeItem(PREFIX + live.current.key)
        return null
      }
      // Reject damaged values before they can populate controlled inputs.
      const valid = (candidate: unknown, expected: unknown): boolean => {
        if (Array.isArray(expected)) return Array.isArray(candidate) && candidate.every(item => typeof item === 'string' || (!!item && typeof item === 'object' && typeof item.name === 'string' && typeof item.salesPersonId === 'string'))
        if (expected === null) return candidate === null || typeof candidate === 'string'
        if (typeof expected === 'object') return !!candidate && typeof candidate === 'object' && Object.entries(expected as Record<string, unknown>).every(([field, item]) => valid((candidate as Record<string, unknown>)[field], item))
        return typeof candidate === typeof expected
      }
      if (!valid(stored.value, seed)) { localStorage.removeItem(PREFIX + live.current.key); return null }
      if (JSON.stringify(stored.value) === baseline.current) return null
      setRestored(true)
      return stored.value as T
    } catch { setError(true); return null }
  }, [])
  const clear = useCallback(() => {
    cleared.current = true
    try { if (live.current.key) localStorage.removeItem(PREFIX + live.current.key) } catch { setError(true) }
    setRestored(false)
  }, [])
  useLayoutEffect(() => {
    if (open) flush()
    else { ready.current = false; setRestored(false) }
  }, [key, value, open, flush])
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      flush()
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [flush])
  return { take, flush, clear, restored, error }
}
