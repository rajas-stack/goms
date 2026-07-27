import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/** Generic "arrive at a list page, scroll to and briefly highlight one row"
 *  behavior: reads `?highlight=<id>`, resolves it against `items` via
 *  `getId`, calls `scrollToIndex` once, and returns that id for ~2s so the
 *  caller can apply a temporary highlight style to the matching row.
 *  Reusable by any future virtualized list page — not Meetings-specific. */
export function useHighlightOnArrival<T>(
  items: T[],
  getId: (item: T) => string,
  scrollToIndex: (index: number) => void,
): string | null {
  const [params] = useSearchParams()
  const highlightId = params.get('highlight')
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const getIdRef = useRef(getId)
  getIdRef.current = getId
  const scrollToIndexRef = useRef(scrollToIndex)
  scrollToIndexRef.current = scrollToIndex

  useEffect(() => {
    if (!highlightId) return
    const index = items.findIndex((item) => getIdRef.current(item) === highlightId)
    if (index === -1) return
    scrollToIndexRef.current(index)
    setHighlighted(highlightId)
    const timer = setTimeout(() => setHighlighted(null), 2000)
    return () => clearTimeout(timer)
  }, [highlightId, items])

  return highlighted
}
