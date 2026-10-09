import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { Avatar } from '@/components/ui/Avatar'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { useMenuKeyboardNav } from '@/components/ui/popover/useMenuKeyboardNav'
import { originOf, useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { DayNightSwitch } from './DayNightSwitch'
import { ThemeSegmented } from './ThemeSegmented'
import { SettingsDialog } from './SettingsDialog'
import { isThemeToggleShortcut } from './shortcuts'

/** Matches menuitem, menuitemradio and menuitemcheckbox. */
const NAV_ITEMS = '[role^="menuitem"]'

/** TopBar's "Options" dropdown: day/night switch, Light/Dark/Eye comfort picker,
 *  and entry points into Settings. Also owns the global theme shortcut, since
 *  the TopBar (and so this menu) is mounted on every screen. */
export function OptionsMenu({ profile, onSignIn, onSignOut }: {
  profile?: { name: string; photoUrl?: string | null }
  onSignIn?: () => void
  onSignOut?: () => void
} = {}) {
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const { resolved, toggle } = useTheme()
  const isNight = resolved === 'dark'

  useMenuKeyboardNav(open, panelRef, NAV_ITEMS)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isThemeToggleShortcut(e)) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const openSettings = () => {
    setOpen(false)
    setSettingsOpen(true)
  }

  return (
    <>
      <div ref={anchorRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Profile options"
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            'group flex h-10 w-10 items-center gap-2 rounded-full border border-line bg-panel p-1 text-[13px] font-medium text-ink-700 outline-none transition-colors duration-150 focus-visible:focus-ring sm:w-[198px] sm:pr-2.5',
            open
              ? 'border-ink-600/40 bg-panel text-ink-900'
              : 'hover:border-ink-600/40 hover:bg-white',
          )}
        >
          {profile ? <Avatar person={profile} size="sm" className="h-7 w-7" /> : (
            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-100 text-muted">
              <Icon name="User" size={16} />
            </span>
          )}
          <span className="hidden min-w-0 flex-1 truncate text-left sm:block">{profile?.name || 'User'}</span>
          <Icon name="ChevronDown" size={13} className={cn('hidden shrink-0 transition-transform duration-200 sm:block', open && 'rotate-180')} />
        </button>

        <PopoverPanel open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} align="end" maxPanelHeight={480} gap={8}>
          {({ maxHeight }) => (
            <motion.div
              ref={panelRef}
              data-canvas-ui
              role="menu"
              aria-label="Options"
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
              style={{ maxHeight, transformOrigin: 'top right' }}
              className="w-[19rem] overflow-y-auto scrollbar-thin rounded-2xl border border-line bg-white p-2 shadow-pop"
            >
              <div className="px-2 pb-2 pt-1">
                <span className="eyebrow">Options</span>
              </div>

              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={isNight}
                onClick={(e) => toggle(originOf(e.currentTarget.querySelector('[data-switch]')))}
                className="group/row flex w-full items-center gap-3 rounded-xl border border-line bg-paper p-2.5 text-left outline-none transition-colors hover:border-ink-600/30 focus-visible:ring-2 focus-visible:ring-indigo/60"
              >
                <span
                  className={cn(
                    'relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg transition-colors duration-300',
                    isNight ? 'bg-indigo-100 text-indigo' : 'bg-amber-100 text-amber-600',
                  )}
                >
                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.span
                      key={isNight ? 'moon' : 'sun'}
                      className="flex"
                      initial={{ y: 14, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -14, opacity: 0 }}
                      transition={{ duration: 0.22 }}
                    >
                      <Icon name={isNight ? 'Moon' : 'Sun'} size={17} />
                    </motion.span>
                  </AnimatePresence>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-ink-900">{isNight ? 'Night mode' : 'Day mode'}</span>
                </span>
                <span data-switch>
                  <DayNightSwitch isNight={isNight} />
                </span>
              </button>

              <div className="px-0.5 pb-1 pt-2.5">
                <ThemeSegmented variant="menu" />
              </div>

              <div className="mx-1 my-2 h-px bg-line" />

              <OptionsItem icon="Settings" label="Settings" onClick={openSettings} />
              {onSignIn && <><div className="mx-1 my-2 h-px bg-line" /><OptionsItem icon="LogIn" label="Sign in" onClick={() => { setOpen(false); onSignIn() }} /></>}
              {onSignOut && <><div className="mx-1 my-2 h-px bg-line" /><OptionsItem icon="LogOut" label="Sign out" onClick={() => { setOpen(false); onSignOut() }} /></>}
            </motion.div>
          )}
        </PopoverPanel>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  )
}

interface OptionsItemProps {
  icon: string
  label: string
  onClick: () => void
  className?: string
}

function OptionsItem({ icon, label, onClick, className }: OptionsItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'group/item flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-ink-900/[0.05] focus-visible:bg-ink-900/[0.05] lg:min-h-0',
        className,
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-panel text-ink-700 transition-colors group-hover/item:bg-white group-hover/item:text-ink-900">
        <Icon name={icon} size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
      </span>
      <Icon name="ChevronRight" size={14} className="text-muted opacity-0 transition-all duration-150 group-hover/item:translate-x-0.5 group-hover/item:opacity-100 group-focus-visible/item:opacity-100" />
    </button>
  )
}
