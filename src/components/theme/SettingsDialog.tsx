import { useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { Link } from 'react-router-dom'
import { WEBSITE_KIND_COPY, type WebsiteKindCopy } from '@/features/tender-websites/websiteKinds'
import { SettingsIcon, type SettingsIconKind } from './SettingsIcon'
import './SettingsMenu.css'

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Settings" description="Configure your workspace." size="md" className="settings-dialog lg:max-w-xl">
      <button type="button" onClick={onClose} className="settings-back focus-visible:focus-ring"><Icon name="ArrowLeft" size={15} />Back to workspace</button>
      <SettingsMenu onNavigate={onClose} />
    </Dialog>
  )
}

const websitePage = ({ route, title, hint }: WebsiteKindCopy, kind: SettingsIconKind) => ({ to: route, kind, title, hint })

const SETTINGS_GROUPS = [
  {
    id: 'system', title: 'System settings', icon: 'SlidersHorizontal',
    pages: [
      { to: '/settings/integrations', kind: 'integrations' as const, title: 'Integrations', hint: 'Connect Google services.' },
      { to: '/settings/dms', kind: 'storage' as const, title: 'DMS Settings', hint: 'Connect Drive and organize documents.' },
      { to: '/settings/credentials', kind: 'credentials' as const, title: 'Credentials', hint: 'Manage shared passphrases.' },
    ],
  },
  {
    id: 'bid-team', title: 'Bid team settings', icon: 'Briefcase',
    pages: [websitePage(WEBSITE_KIND_COPY.tender, 'tender'), websitePage(WEBSITE_KIND_COPY.verification, 'verification')],
  },
  {
    id: 'pre-sales', title: 'Pre-sales', icon: 'TrendingUp',
    pages: [{ to: '/settings/competitors', kind: 'competitors' as const, title: 'Competitors', hint: 'Rival companies and what they offer.' }],
  },
]

const SETTINGS_BUTTON_CLASS = 'settings-menu-item group inline-flex h-11 max-w-full items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-medium text-ink-900 shadow-sm transition-colors hover:border-ink-600/30 hover:bg-panel focus-visible:focus-ring lg:h-10'

export function SettingsMenu({ onNavigate }: { onNavigate?: () => void }) {
  const [groupId, setGroupId] = useState<string | null>(null)
  const [direction, setDirection] = useState(1)
  const contentRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const selectedGroup = SETTINGS_GROUPS.find(group => group.id === groupId)

  return (
    <div>
      <nav aria-label="Settings navigation" className="mb-3 flex min-h-9 flex-wrap items-center gap-2 text-sm text-muted">
        {selectedGroup ? <>
          <button type="button" onClick={() => { setDirection(-1); setGroupId(null) }} className="rounded px-1 py-1 hover:text-ink-900 focus-visible:focus-ring">Settings</button>
          <Icon name="ChevronRight" size={14} />
          <span aria-current="page" className="font-medium text-ink-900">{selectedGroup.title}</span>
        </> : <span aria-current="page" className="font-medium text-ink-900">Settings</span>}
      </nav>
      <div className="min-h-[104px] overflow-hidden">
        <AnimatePresence initial={false} mode="wait" custom={direction}>
          <motion.div
            key={selectedGroup?.id ?? 'groups'}
            ref={contentRef}
            role="group"
            aria-label={selectedGroup?.title ?? 'Settings groups'}
            className="flex flex-wrap gap-2 p-1"
            custom={direction}
            variants={{
              enter: (step: number) => ({ opacity: 0, x: reducedMotion ? 0 : step * 24 }),
              center: { opacity: 1, x: 0 },
              exit: (step: number) => ({ opacity: 0, x: reducedMotion ? 0 : step * -24 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.23, 1, 0.32, 1] }}
            onAnimationComplete={phase => {
              if (phase === 'center') contentRef.current?.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true })
            }}
          >
            {selectedGroup ? selectedGroup.pages.map(page => (
              <Link key={page.to} to={page.to} onClick={onNavigate} title={page.hint} className={SETTINGS_BUTTON_CLASS}>
                <SettingsIcon kind={page.kind} />
                <span className="min-w-0"><span className="block">{page.title}</span><span className="sr-only">{page.hint}</span></span>
                <Icon name="ChevronRight" size={14} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
              </Link>
            )) : SETTINGS_GROUPS.map(group => (
              <button key={group.id} type="button" onClick={() => { setDirection(1); setGroupId(group.id) }} className={SETTINGS_BUTTON_CLASS}>
                <Icon name={group.icon} size={16} className="shrink-0" />
                <span className="min-w-0">{group.title}</span>
                <Icon name="ChevronRight" size={14} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

export function Kbd({ children }: { children: string }) {
  return <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md border border-line border-b-2 bg-panel px-1.5 font-mono text-[10.5px] font-medium text-ink-700">{children}</kbd>
}
