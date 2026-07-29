import { Icon } from '@/components/ui/Icon'

/** Suspense fallback for lazy-loaded routes (see router.tsx) — shown for the
 *  brief moment a route's own JS chunk is still downloading. */
export function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Icon name="Loader" className="animate-spin text-muted" size={24} />
    </div>
  )
}
