import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { originOf, useTheme, type ThemePreference } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { THEME_OPTIONS } from './ThemeSegmented'
import { SHORTCUTS } from './shortcuts'

export type SettingsSection = 'appearance' | 'shortcuts'

interface Props {
  open: boolean
  onClose: () => void
  /** Section to scroll into view on open. */
  section?: SettingsSection
}

export function SettingsDialog({ open, onClose, section = 'appearance' }: Props) {
  const shortcutsRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open || section !== 'shortcuts') return
    const id = window.setTimeout(() => shortcutsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120)
    return () => window.clearTimeout(id)
  }, [open, section])

  return (
    <Dialog open={open} onClose={onClose} title="Settings" description="Personalise how GOMS looks and works on this device." size="lg">
      <div className="space-y-8">
        <AppearanceSection />
        <section ref={shortcutsRef} aria-labelledby="settings-shortcuts" className="scroll-mt-4">
          <SectionHeading id="settings-shortcuts" icon="Keyboard" title="Keyboard shortcuts" hint="Work faster without leaving the keyboard." />
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {SHORTCUTS.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-4 px-4 py-2.5 text-[13px]">
                <span className="text-ink">{s.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {s.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Dialog>
  )
}

function AppearanceSection() {
  const { preference, resolved, setPreference } = useTheme()
  return (
    <section aria-labelledby="settings-appearance">
      <SectionHeading
        id="settings-appearance"
        icon="Palette"
        title="Appearance"
        hint={preference === 'system' ? `Following your device — currently ${resolved === 'dark' ? 'night' : 'day'}.` : 'Applies across every module.'}
      />
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
        {THEME_OPTIONS.map((opt) => {
          const active = preference === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={(e) => setPreference(opt.value, originOf(e.currentTarget))}
              className={cn(
                'group relative rounded-2xl border p-1.5 text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-indigo/60',
                active
                  ? 'border-indigo bg-indigo-100/60 shadow-[0_0_0_3px_rgb(var(--c-indigo)/0.15)]'
                  : 'border-line bg-white hover:-translate-y-0.5 hover:border-ink-600/40 hover:shadow-panel',
              )}
            >
              <ThemePreview value={opt.value} />
              <span className="flex items-center justify-between px-1.5 pb-0.5 pt-2.5">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
                  <Icon name={opt.icon} size={14} className={active ? 'text-indigo' : 'text-muted'} />
                  {opt.label}
                </span>
                <span
                  className={cn(
                    'flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-colors',
                    active ? 'border-indigo bg-indigo text-paper' : 'border-line',
                  )}
                >
                  {active && (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 30 }}>
                      <Icon name="Check" size={11} />
                    </motion.span>
                  )}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** A miniature app shell drawn in the real theme tokens: wrapping it in
 *  `.light`/`.dark` re-scopes the CSS variables, so the thumbnail is exact
 *  whatever theme the app itself is showing. */
function ThemePreview({ value }: { value: ThemePreference }) {
  if (value === 'system') {
    return (
      <span className="relative block aspect-[4/3] overflow-hidden rounded-xl">
        <MiniShell scheme="light" />
        <span className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
          <MiniShell scheme="dark" />
        </span>
      </span>
    )
  }
  return (
    <span className="block aspect-[4/3] overflow-hidden rounded-xl">
      <MiniShell scheme={value} />
    </span>
  )
}

function MiniShell({ scheme }: { scheme: 'light' | 'dark' }) {
  return (
    <span className={cn(scheme, 'flex h-full w-full flex-col bg-paper ring-1 ring-inset ring-line')}>
      <span className="flex h-[18%] items-center gap-1 border-b border-line bg-white px-2">
        <span className="h-1.5 w-1.5 rounded-full bg-crimson" />
        <span className="h-1 w-6 rounded-full bg-ink-900/70" />
        <span className="ml-auto h-1.5 w-5 rounded-full bg-ink-900" />
      </span>
      <span className="flex flex-1 gap-1.5 p-2">
        <span className="flex w-[28%] flex-col gap-1 rounded-md bg-panel p-1">
          <span className="h-1 w-full rounded-full bg-indigo/70" />
          <span className="h-1 w-3/4 rounded-full bg-ink-600/40" />
          <span className="h-1 w-2/3 rounded-full bg-ink-600/40" />
        </span>
        <span className="flex flex-1 flex-col gap-1.5">
          <span className="flex flex-1 items-end gap-1 rounded-md border border-line bg-white p-1.5">
            <span className="h-[40%] flex-1 rounded-sm bg-blue/70" />
            <span className="h-[70%] flex-1 rounded-sm bg-teal/70" />
            <span className="h-[55%] flex-1 rounded-sm bg-purple/70" />
            <span className="h-[85%] flex-1 rounded-sm bg-emerald/70" />
          </span>
          <span className="h-1 w-1/2 rounded-full bg-ink-600/40" />
        </span>
      </span>
    </span>
  )
}

function SectionHeading({ id, icon, title, hint }: { id: string; icon: string; title: string; hint: string }) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-panel text-ink-700">
        <Icon name={icon} size={16} />
      </span>
      <div>
        <h3 id={id} className="text-[14px] font-semibold text-ink-900">{title}</h3>
        <p className="text-[12.5px] text-muted">{hint}</p>
      </div>
    </div>
  )
}

export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md border border-line border-b-2 bg-panel px-1.5 font-mono text-[10.5px] font-medium text-ink-700">
      {children}
    </kbd>
  )
}
