import type { ReactNode } from 'react'
import { Icon } from '@/components/ui/Icon'

/** Full-height explanation shown in place of the editor frame (offline build, server down, not configured). */
export function EditorNotice({ icon, title, children, actions }: { icon: string; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-4 sm:p-8">
      <div role="alert" className="neu-raised w-full max-w-lg rounded-2xl p-6 sm:p-8">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber/10 text-amber"><Icon name={icon} size={20} /></span>
        <h2 className="mt-4 text-[17px] font-semibold text-ink-900">{title}</h2>
        <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-muted">{children}</div>
        {actions && <div className="mt-5 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export const SETUP_DOC = 'docs/ONLYOFFICE_SETUP.md'
