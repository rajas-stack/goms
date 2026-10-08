import { isHttpUrl } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

/** A website shown by its name and opened in a new tab. Only http(s) links
 *  become anchors; anything else renders as plain text so a stored value can
 *  never smuggle in a javascript: or data: URL. */
export function TenderWebsiteLink({ site, className }: { site: { name: string; url: string }; className?: string }) {
  if (!isHttpUrl(site.url)) return <span className={cn('text-ink-800', className)}>{site.name}</span>
  return (
    <a href={site.url.trim()} target="_blank" rel="noopener noreferrer" title={site.url}
      className={cn('inline-flex max-w-full items-center gap-1 text-goms-navy underline decoration-goms-navy/30 underline-offset-2 hover:decoration-goms-navy focus-visible:focus-ring rounded-sm', className)}>
      <span className="truncate">{site.name}</span>
      <Icon name="ExternalLink" size={12} className="shrink-0 opacity-70" />
    </a>
  )
}
