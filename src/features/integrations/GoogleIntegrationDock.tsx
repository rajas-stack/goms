import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { GoogleService } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { loadGoogleIdentity } from '@/features/dms/googleDrive'
import { useCanReadAny } from '@/lib/permissions'
import { NAV_MODULES } from '@/lib/routeModules'
import { GOOGLE_PRODUCTS } from './catalog'
import { availableGooglePages, useGooglePages } from './registry'
import { googleServiceEnabled, googleSettings } from './settings'
import { useGoogleAccount } from './session'
import { GoogleWorkspacePanel } from './GoogleWorkspacePanel'

/** Activation deploys real API widgets to the chosen module; no redirect launcher. */
export function GoogleIntegrationDock() {
  const account = useGoogleAccount()
  const location = useLocation()
  const pages = useGooglePages('drive')
  const page = location.pathname.startsWith('/documents/')
    ? pages.find(item => item.id === location.pathname.split('/')[2])
    : [...pages].sort((a, b) => b.path.length - a.path.length).find(item => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`))
  const products = page ? GOOGLE_PRODUCTS.filter(product => availableGooglePages(product.id).some(item => item.id === page.id) && googleServiceEnabled(product.id, page.id)) : []
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<GoogleService | null>(null)
  const [error, setError] = useState('')
  const allowed = useCanReadAny(page?.id === 'accounts' ? NAV_MODULES.map : NAV_MODULES[page?.id as keyof typeof NAV_MODULES] ?? [])
  const settings = googleSettings(account)
  useEffect(() => { setOpen(false); setSelected(null); setError('') }, [location.pathname, account?.uid, account?.googleId])
  useEffect(() => { if (selected && (!page || !googleServiceEnabled(selected, page.id))) setSelected(null); if (!products.length) setOpen(false) }, [selected, page?.id, products.map(product => product.id).join(',')])
  useEffect(() => { let active = true; if (account && page && settings.clientId) void loadGoogleIdentity().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Google sign-in could not load.') }); return () => { active = false } }, [account?.uid, page?.id, settings.clientId])
  if (!account || !page || !products.length || !allowed) return null
  return <>
    <Button className="fixed bottom-40 right-4 z-30 shadow-pop lg:bottom-24" size="sm" onClick={() => setOpen(true)} aria-label="Open Google tools"><Icon name="PanelsTopLeft" size={16} />Google tools</Button>
    {open && <Dialog open onClose={() => { setOpen(false); setSelected(null) }} title={`Google tools · ${page.label}`} size="lg">
      <div className="flex flex-wrap gap-2">{products.map(product => <Button key={product.id} size="sm" variant={selected === product.id ? 'primary' : 'secondary'} onClick={() => setSelected(product.id)}><Icon name={product.icon} size={14} />{product.name}</Button>)}</div>
      {error && <p role="alert" className="mt-3 text-xs text-crimson">{error}</p>}
      {selected ? <GoogleWorkspacePanel key={selected} service={selected} pageId={page.id} /> : <p className="mt-4 text-sm text-muted">Choose a service to work here.</p>}
    </Dialog>}
  </>
}
