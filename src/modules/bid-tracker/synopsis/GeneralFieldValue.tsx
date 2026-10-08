import { isHttpUrl } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { useTenderWebsites } from '@/features/tender-websites/api'
import { TenderWebsiteLink } from '@/features/tender-websites/TenderWebsiteLink'
import { formatFriendlyValue } from '@/lib/friendlyDate'
import { cn } from '@/lib/utils'
import { COMPLIANCE_TONE, dateFormatOf } from './GeneralFieldControl'
import type { GeneralField } from './generalFields'
import { entryLabel, parseWebsiteValue } from './websiteValue'
import { MeetingMapLink } from './MeetingMapLink'

function Websites({ value }: { value: string }) {
  const { data: saved = [] } = useTenderWebsites()
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {parseWebsiteValue(value).map(entry => (
        <li key={entry.line} className="min-w-0 max-w-full">
          {entry.kind === 'site'
            ? <TenderWebsiteLink site={{ name: entryLabel(entry, saved), url: entry.url }} />
            : <span className="break-words">{entry.text}</span>}
        </li>
      ))}
    </ul>
  )
}

/** Read-only rendering of a saved General value. */
export function GeneralFieldValue({ field, value }: { field: GeneralField; value: string }) {
  const text = value.trim()
  if (!text) return <span className="text-muted/70">—</span>
  if (field.kind === 'address') return (
    <div className="flex flex-wrap items-start gap-3">
      <span className="whitespace-pre-wrap break-words">{text}</span>
      <MeetingMapLink address={text} />
    </div>
  )
  const format = dateFormatOf(field)
  if (format) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Icon name={format === 'date' ? 'Calendar' : 'CalendarClock'} size={13} className="text-muted" />
        {formatFriendlyValue(text, format)}
      </span>
    )
  }
  if (field.kind === 'select') {
    return <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[12px] font-medium capitalize', COMPLIANCE_TONE[text] ?? 'border-line bg-panel text-ink-800')}>{text}</span>
  }
  if (field.kind === 'department') {
    return <span className="inline-flex items-start gap-1.5"><Icon name="Landmark" size={13} className="mt-0.5 shrink-0 text-muted" /><span className="whitespace-pre-wrap break-words">{text}</span></span>
  }
  if (field.kind === 'websites') return <Websites value={text} />
  if (field.kind === 'url' && isHttpUrl(text)) return <TenderWebsiteLink site={{ name: text, url: text }} />
  return <span className="whitespace-pre-wrap break-words">{text}</span>
}
