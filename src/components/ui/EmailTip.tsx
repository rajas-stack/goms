import type { ReactNode } from 'react'
import { Tooltip } from './Tooltip'

/** Shows a person's email in the app's own hover tooltip (instant, edge-clamped) — the browser's `title` hint needs a long
 *  still hover and is swallowed on the pannable org-chart canvas. Renders the children untouched when there is no email. */
export function EmailTip({ email, children }: { email?: string | null; children: ReactNode }) {
  return email ? <Tooltip label={email} side="top">{children}</Tooltip> : <>{children}</>
}
