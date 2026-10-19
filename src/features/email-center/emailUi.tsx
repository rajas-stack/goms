import type { ComponentProps, ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { Avatar } from '@/components/ui/Avatar'
import { PersonName } from '@/components/ui/PersonName'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'

type IconName = ComponentProps<typeof Icon>['name']
export interface MailPerson { name?: string | null; email: string }

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
/** Compact mail time: "10:45 pm" today, "Yesterday", "19 Oct" this year, else "19 Oct 2025". */
export function mailTime(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  if (sameDay(d, now)) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-IN', d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}
/** Full timestamp for tooltips: "Sun, 19 Oct 2026, 10:45 pm". */
export const mailTimeFull = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export function MailTime({ iso, className }: { iso: string; className?: string }) {
  return <time dateTime={iso} title={mailTimeFull(iso)} className={cn('shrink-0 whitespace-nowrap text-[12px] tabular-nums text-muted', className)}>{mailTime(iso)}</time>
}

/** GOMS person display for a mail participant (initials avatar; the address shows on hover). */
export function MailPersonName({ person, size = 'sm', subtitle, className }: { person: MailPerson; size?: 'xs' | 'sm' | 'md'; subtitle?: ReactNode; className?: string }) {
  return <span title={person.email} className={cn('min-w-0', className)}><PersonName person={{ name: person.name || person.email }} size={size} subtitle={subtitle} nameClassName="font-medium text-ink-900" /></span>
}
/** Avatar only — the name and address show on hover. */
export function MailAvatar({ person, size = 'sm' }: { person: MailPerson; size?: 'xs' | 'sm' | 'md' }) {
  return <Tooltip label={person.name ? `${person.name} · ${person.email}` : person.email}><Avatar person={{ name: person.name || person.email }} size={size} /></Tooltip>
}

const FILE_TYPES: { test: RegExp; icon: IconName; tone: string; label: string }[] = [
  { test: /\.pdf$|application\/pdf/i, icon: 'FileText', tone: 'bg-red-50 text-red-600 ring-red-100', label: 'PDF' },
  { test: /\.(xlsx?|csv|ods)$|spreadsheet|excel|csv/i, icon: 'FileSpreadsheet', tone: 'bg-emerald-50 text-emerald-600 ring-emerald-100', label: 'Sheet' },
  { test: /\.(docx?|odt|rtf)$|wordprocessing|msword/i, icon: 'FileText', tone: 'bg-blue-50 text-blue-600 ring-blue-100', label: 'Doc' },
  { test: /\.(pptx?|odp|key)$|presentation|powerpoint/i, icon: 'Presentation', tone: 'bg-orange-50 text-orange-600 ring-orange-100', label: 'Slides' },
  { test: /\.(png|jpe?g|gif|webp|svg|heic)$|^image\//i, icon: 'FileImage', tone: 'bg-violet-50 text-violet-600 ring-violet-100', label: 'Image' },
  { test: /\.(zip|rar|7z|tar|gz)$|zip|compressed/i, icon: 'FileArchive', tone: 'bg-amber-50 text-amber-600 ring-amber-100', label: 'Archive' },
  { test: /\.(mp4|mov|avi|mkv|webm)$|^video\//i, icon: 'Video', tone: 'bg-pink-50 text-pink-600 ring-pink-100', label: 'Video' },
]
export function fileType(name: string, mime = '') {
  return FILE_TYPES.find(t => t.test.test(name) || t.test.test(mime)) ?? { icon: 'FileText' as IconName, tone: 'bg-ink-900/[0.05] text-ink-600 ring-line', label: 'File' }
}
export const fileSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`
/** Name without its extension (the type is shown by the icon). */
export const fileBase = (name: string) => name.replace(/\.[a-z0-9]{1,6}$/i, '') || name

export function AttachmentCard({ name, mime, size, onOpen, onDownload, disabled }: { name: string; mime: string; size: number; onOpen?: () => void; onDownload?: () => void; disabled?: boolean }) {
  const t = fileType(name, mime)
  return (
    <div className="group flex w-60 items-center gap-3 rounded-xl border border-line bg-white p-2.5 transition-shadow hover:shadow-[0_4px_14px_rgba(11,43,73,0.08)]">
      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg ring-1', t.tone)} aria-hidden><Icon name={t.icon} size={18} /></span>
      <button type="button" disabled={disabled || !onOpen} onClick={onOpen} title={name} className="min-w-0 flex-1 text-left disabled:cursor-default">
        <span className="block truncate text-[13px] font-medium text-ink-900">{fileBase(name)}</span>
        <span className="block text-[11.5px] text-muted">{t.label} · {fileSize(size)}</span>
      </button>
      {onDownload && <Tooltip label="Download"><button type="button" aria-label={`Download ${name}`} disabled={disabled} onClick={onDownload} className="grid h-8 w-8 place-items-center rounded-lg text-muted opacity-70 transition hover:bg-ink-900/[0.05] hover:text-ink-900 group-hover:opacity-100"><Icon name="Download" size={15} /></button></Tooltip>}
    </div>
  )
}

/** Gentle enter motion (fade + rise, ~0.15 s); none when the user prefers reduced motion. */
export function MotionIn({ children, className, delay = 0, as = 'div' }: { children: ReactNode; className?: string; delay?: number; as?: 'div' | 'li' | 'article' }) {
  const reduce = useReducedMotion()
  const M = motion[as]
  return <M className={className} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15, ease: [0.2, 0, 0, 1], delay: reduce ? 0 : Math.min(delay, 0.15) }}>{children}</M>
}
