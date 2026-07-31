import { useCallback, useState } from 'react'

const KEY = 'gorms:dismissed-duplicate-pairs'

function pairKey(idA: string, idB: string): string {
  return [idA, idB].sort().join('::')
}

function readStored(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Duplicate-contact pairs a user has explicitly said "not a duplicate"
 *  about, persisted locally so a suggested match doesn't keep resurfacing —
 *  this app has no backend yet, same localStorage-as-source-of-truth
 *  convention as `useCustomOptions`. */
export function useDismissedDuplicatePairs() {
  const [dismissed, setDismissed] = useState(readStored)

  const isDismissed = useCallback(
    (idA: string, idB: string) => dismissed.has(pairKey(idA, idB)),
    [dismissed],
  )

  const dismiss = useCallback((idA: string, idB: string) => {
    setDismissed((prev) => {
      if (prev.has(pairKey(idA, idB))) return prev
      const next = new Set(prev)
      next.add(pairKey(idA, idB))
      localStorage.setItem(KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  return { isDismissed, dismiss }
}
