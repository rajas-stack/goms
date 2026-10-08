import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DMS_MODULES, type DmsModule } from '@/features/dms/connections'
import { useConnections } from '@/features/dms/useConnections'
import { getDriveSession, getFolder, type DriveFile } from '@/features/dms/googleDrive'
import { DocumentLibrary } from '@/features/dms/DocumentLibrary'

export function DmsDocumentsPage() {
  const { module } = useParams()
  const connections = useConnections()
  const connection = connections.find((item) => !item.isMaster && item.modules.includes(module as DmsModule))
  const [root, setRoot] = useState<DriveFile | null>(null)
  const [error, setError] = useState('')
  const session = connection ? getDriveSession(connection.id) : null
  useEffect(() => {
    let active = true
    setRoot(null); setError('')
    if (connection && session && connection.settings.rootFolderId) getFolder(connection.settings.rootFolderId, connection.id).then((folder) => { if (active) setRoot(folder) }).catch((e) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [connection?.id, connection?.settings.rootFolderId, session?.accessToken])
  return <div className="h-full overflow-y-auto scrollbar-thin"><div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
    <h1 className="text-2xl font-semibold text-ink-900">{DMS_MODULES.find((item) => item.id === module)?.label ?? 'Workspace'} documents</h1>
    <p className="mb-6 mt-1 text-sm text-muted">{connection?.name ?? 'No DMS assigned to this place'}</p>
    {error && <p role="alert" className="mb-4 text-sm text-crimson">{error}</p>}
    {connection?.settings.provider === 'external' ? <a className="text-sm text-indigo underline" href={connection.settings.externalUrl} target="_blank" rel="noopener noreferrer">Open {connection.name}</a> : connection && session && root ? <DocumentLibrary key={connection.id} root={root} settings={connection.settings} connectionId={connection.id} onSessionExpired={() => { setRoot(null); setError('Reconnect this DMS to continue.') }} /> : <div className="rounded-xl border border-line bg-white p-6"><p className="mb-3 text-sm text-muted">{session ? 'Loading the document folder...' : 'Connect the assigned DMS before opening documents.'}</p><Link className="text-sm text-indigo underline" to={connection ? `/settings/dms/${connection.id}` : '/settings/dms'}>{connection ? 'Configure this DMS' : 'Open DMS Settings'}</Link></div>}
  </div></div>
}
