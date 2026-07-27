import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/** Renders `children` into `document.body`, escaping every ancestor's
 *  `overflow`/`z-index` stacking context — the mechanism every floating
 *  popover in this app positions itself with. */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}
