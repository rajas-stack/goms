import { useRouteError } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'

/** The router's root `errorElement` — the last line of defense for an
 *  uncaught render error anywhere in the route tree, including a failed
 *  lazy-chunk load. Statically imported in router.tsx (never itself lazy):
 *  it has to stay available even when the thing that broke IS a lazy import.
 *  Never renders the underlying error's message — only logs it — so a
 *  normal user never sees a stack trace or a raw exception string. */
export function GlobalErrorScreen() {
  const error = useRouteError()
  console.error('[gorms] unhandled route error', error)

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-paper p-6 text-center">
      <span className="eyebrow">Something went wrong</span>
      <h1 className="text-2xl font-semibold text-ink-900">This page hit a snag.</h1>
      <p className="max-w-sm text-sm text-muted">
        Try reloading — if it keeps happening, head back to the home screen and pick up from there.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => window.location.reload()}>
          <Icon name="RotateCcw" size={15} /> Reload
        </Button>
        <Button variant="primary" onClick={() => { window.location.href = '/' }}>
          <Icon name="Home" size={15} /> Go home
        </Button>
      </div>
    </div>
  )
}
