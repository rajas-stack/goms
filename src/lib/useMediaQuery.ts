import { useEffect, useState } from 'react'

/** Live media-query match, kept in sync as the viewport crosses the
 *  breakpoint (not just read once at mount) — used to pick a sensible
 *  List/Canvas default per viewport without hardcoding the breakpoint in
 *  more than one place. Guarded for environments without `window` even
 *  though this app is client-only today. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false))

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
