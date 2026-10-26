import { useEffect } from 'react'
import { useBlocker, type Location } from 'react-router-dom'

export const DISCARD_CHANGES_MESSAGE = 'You have unsaved changes. Discard them?'

/** The open record lives in `?sel=&kind=`; other query params (list filters) do not leave it. */
const RECORD_PARAMS = ['sel', 'kind']
const leavesRecord = (from: Location, to: Location) => from.pathname !== to.pathname
  || RECORD_PARAMS.some((k) => new URLSearchParams(from.search).get(k) !== new URLSearchParams(to.search).get(k))

/** While `when` is true, asks before leaving the record being edited (another person, closing the panel, another
 *  page) and before the page unloads. Render it only while editing: a router allows one blocker at a time. */
export function UnsavedChangesGuard({ when }: { when: boolean }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => when && leavesRecord(currentLocation, nextLocation))
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm(DISCARD_CHANGES_MESSAGE)) blocker.proceed()
    else blocker.reset()
  }, [blocker])
  useEffect(() => {
    if (!when) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [when])
  return null
}
