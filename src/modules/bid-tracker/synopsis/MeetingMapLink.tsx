import { useGoogleAccount } from '@/features/integrations/session'
import { googleServiceEnabled } from '@/features/integrations/settings'
import { Icon } from '@/components/ui/Icon'

/** Google Maps URLs open the installed app when supported, otherwise the website. */
export function MeetingMapLink({ address }: { address: string }) {
  const account = useGoogleAccount()
  if (!address.trim() || !googleServiceEnabled('maps', 'opportunity')) return null
  return (
    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}${account ? `&authuser=${encodeURIComponent(account.email)}` : ''}`}
      target="_blank" rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-ink hover:bg-panel focus-visible:focus-ring">
      <Icon name="MapPin" size={14} /> Open in Google Maps
    </a>
  )
}
