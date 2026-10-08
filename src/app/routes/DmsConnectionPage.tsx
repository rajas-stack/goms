import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { DmsSetup } from '@/features/dms/DmsSetup'
import { loadConnections } from '@/features/dms/connections'

export function DmsConnectionPage() {
  const { connectionId } = useParams()
  const [query] = useSearchParams()
  const navigate = useNavigate()
  const [newId] = useState(() => crypto.randomUUID())
  const id = connectionId ?? newId
  const connection = loadConnections().find((item) => item.id === id)
  const master = connection?.isMaster ?? query.get('master') === 'true'
  return <div className="h-full overflow-y-auto scrollbar-thin"><div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
    <Link to="/settings/dms" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"><ArrowLeft size={15} />DMS Settings</Link>
    <h1 className="mb-6 text-2xl font-semibold text-ink-900">{connection?.name ?? (master ? 'Create master DMS' : 'Create new DMS')}</h1>
    {connectionId && !connection ? <p role="alert" className="text-sm text-muted">This DMS connection was removed. Return to DMS Settings.</p> : <div className="rounded-2xl border border-line p-4 sm:p-6"><DmsSetup key={id} connectionId={id} master={master} onSaved={(savedId) => { if (!connectionId) navigate(`/settings/dms/${savedId}`, { replace: true }) }} /></div>}
  </div></div>
}
