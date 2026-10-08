import { useEffect, useState } from 'react'
import { CONNECTIONS_CHANGED, CONNECTIONS_KEY, loadConnections } from './connections'

export function useConnections() {
  const [connections, setConnections] = useState(loadConnections)
  useEffect(() => {
    const update = () => setConnections(loadConnections())
    const onStorage = (event: StorageEvent) => { if (event.key === CONNECTIONS_KEY) update() }
    window.addEventListener(CONNECTIONS_CHANGED, update)
    window.addEventListener('storage', onStorage)
    window.addEventListener('goms:dms-session-changed', update)
    const timer = window.setInterval(update, 60000)
    return () => {
      window.removeEventListener(CONNECTIONS_CHANGED, update)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('goms:dms-session-changed', update)
      window.clearInterval(timer)
    }
  }, [])
  return connections
}
