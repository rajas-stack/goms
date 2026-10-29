import { Fragment, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'
import { MailPersonName } from './emailUi'
import { headerNames, linkLabel, parseEmailBody, parseQuotedHeader, unquote } from './emailText'

const TOKEN = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]|[\w.+-]+@[\w-]+\.[\w.-]*\w|\*[^*\n]{1,120}\*)/g

/** Plain text with links as compact chips, addresses as mailto links and *bold* as bold. */
function RichText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(TOKEN)
  return <div className={cn('whitespace-pre-wrap break-words [overflow-wrap:anywhere]', className)}>{parts.map((part, i) => {
    if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>
    if (/^https?:/.test(part)) return <a key={i} href={part} target="_blank" rel="noopener noreferrer" title={part} className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md bg-indigo/[0.07] px-1.5 py-px align-baseline text-[0.92em] font-medium text-indigo no-underline ring-1 ring-indigo/15 transition hover:bg-indigo/[0.12]"><Icon name="ExternalLink" size={12} className="shrink-0" /><span className="truncate">{linkLabel(part)}</span></a>
    if (part.startsWith('*')) return <strong key={i} className="font-semibold">{part.slice(1, -1)}</strong>
    return <a key={i} href={`mailto:${part}`} className="text-indigo underline decoration-indigo/30 underline-offset-2 hover:decoration-indigo">{part}</a>
  })}</div>
}

/** Gmail-style collapsed section: a small pill that reveals its content with a short fade. */
function Reveal({ label, icon, defaultOpen = false, children }: { label: string; icon: ComponentProps<typeof Icon>['name']; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen); const reduce = useReducedMotion()
  return <div>
    <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-ink-900/[0.03] px-2.5 py-1 text-[12px] font-medium text-muted transition hover:bg-ink-900/[0.06] hover:text-ink-900 active:scale-[0.97]">
      <Icon name={icon} size={13} />{open ? `Hide ${label.toLowerCase()}` : label}<Icon name="ChevronDown" size={12} className={cn('transition-transform duration-200', open && 'rotate-180')} />
    </button>
    <AnimatePresence initial={false}>{open && <motion.div initial={reduce ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -4 }} transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }} className="mt-3">{children}</motion.div>}</AnimatePresence>
  </div>
}

function NameList({ value }: { value: string }) {
  const names = headerNames(value); const shown = names.slice(0, 4)
  return <span>{shown.join(', ')}{names.length > shown.length && <Tooltip label={names.slice(shown.length).join(', ')}><span className="ml-1 rounded bg-ink-900/[0.05] px-1.5 py-px text-[11px] font-medium text-ink-600">+{names.length - shown.length} more</span></Tooltip>}</span>
}

/** One quoted/forwarded message: header as a tidy card, its body rendered recursively. */
function QuotedMessage({ text }: { text: string }) {
  const { fields, rest } = parseQuotedHeader(unquote(text))
  const get = (label: string) => fields.find(f => f.label === label)?.value
  const from = get('From'), sent = get('Sent') ?? get('Date'), subject = get('Subject')
  const fromEmail = from && /<([^>]+)>/.exec(from)?.[1]
  return <div className="border-l-2 border-indigo/20 pl-4">
    {fields.length > 0 && <div className="mb-3 space-y-1.5 rounded-xl bg-ink-900/[0.025] px-3.5 py-3 text-[12.5px] text-ink-700">
      <div className="flex items-start justify-between gap-3">
        {from ? <MailPersonName person={{ name: headerNames(from)[0], email: fromEmail ?? from }} size="xs" /> : <span />}
        {sent && <span className="shrink-0 text-[11.5px] tabular-nums text-muted">{sent}</span>}
      </div>
      {subject && <p className="font-medium text-ink-900">{subject}</p>}
      {(['To', 'Cc'] as const).map(label => get(label) && <p key={label} className="text-muted"><span className="mr-1.5 font-medium text-ink-600">{label}</span><NameList value={get(label)!} /></p>)}
    </div>}
    <EmailBody text={rest} nested />
  </div>
}

/** Readable plain-text email: the new text up front, quoted history and signature/disclaimer folded away. */
export function EmailBody({ text, nested = false }: { text: string; nested?: boolean }) {
  const { body, quoted, footer } = useMemo(() => parseEmailBody(text), [text])
  return <div className="space-y-4">
    {body && <RichText text={body} className={nested ? 'text-[13.5px] leading-6 text-ink-700' : 'text-[14.5px] leading-7 text-ink-900'} />}
    {footer && <Reveal label="Signature & disclaimer" icon="ShieldCheck"><RichText text={footer} className="text-[12px] leading-5 text-muted" /></Reveal>}
    {quoted && <Reveal label={nested ? 'Earlier message' : 'Show trimmed content'} icon="MoreHorizontal" defaultOpen={!body}><QuotedMessage text={quoted} /></Reveal>}
  </div>
}
