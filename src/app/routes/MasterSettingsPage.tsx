import { Link } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { usePermissions } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { MASTER_PAGE_LIST } from '@/features/masters/mastersList'
import { MASTER_RENDERERS } from '@/features/masters/mastersRegistry'
import '@/components/theme/SettingsMenu.css'

/** Settings > Masters > <master>: one page per entry of MASTER_PAGE_LIST. */
export function MasterSettingsPage({ kind }: { kind: string }) {
  const page = MASTER_PAGE_LIST.find((p) => p.kind === kind)
  const Render = MASTER_RENDERERS[kind]
  const perms = usePermissions()
  const allowed = !page || !perms.enforced || !page.modules.length || page.modules.some((m) => perms.level(m) !== 'N')
  return (
    <div className="flex h-full flex-col">
      <div className={cn('shrink-0 px-4 pt-6 sm:px-6', !page?.wide && 'mx-auto w-full max-w-4xl')}>
        <Link to="/settings" className="settings-back focus-visible:focus-ring"><Icon name="ArrowLeft" size={15} />Settings</Link>
        <h1 className="mt-1 font-display text-xl font-semibold text-ink-900">{page?.title ?? 'Master not found'}</h1>
        {page && <p className="mt-0.5 text-[13px] text-muted">Settings › Masters › {page.title}</p>}
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto scrollbar-thin', page?.wide ? 'mt-3' : 'mx-auto w-full max-w-4xl px-4 sm:px-6')}>
        {!page || !Render ? null : allowed ? <Render /> : <p role="alert" className="p-6 text-[13px] text-muted">You don’t have access to this master.</p>}
      </div>
    </div>
  )
}
