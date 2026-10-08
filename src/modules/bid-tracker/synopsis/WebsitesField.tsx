import { useMemo } from 'react'
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown'
import { useTenderWebsites } from '@/features/tender-websites/api'
import { entryLabel, parseWebsiteValue, websitesFromLabels } from './websiteValue'

/** Pick one or more tender websites saved in Settings. */
export function WebsitesField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  const { data: saved = [], isLoading } = useTenderWebsites()
  const selected = useMemo(() => [...new Set(parseWebsiteValue(value).map(entry => entryLabel(entry, saved)))], [value, saved])
  const groups = useMemo(() => [{ label: null, options: saved.map(site => site.name) }], [saved])

  return (
    <div id={id} role="group" aria-label={label} className="space-y-1">
      <MultiSelectDropdown
        value={selected}
        groups={groups}
        storageKey="general-tender-websites"
        allowCustomAdd={false}
        searchable
        searchPlaceholder="Search websites…"
        placeholder={isLoading ? 'Loading websites…' : saved.length ? 'Choose websites' : 'No websites saved yet'}
        onChange={labels => onChange(websitesFromLabels(labels, value, saved))}
      />
      <p className="text-[11px] text-muted">Add or edit websites in Settings (gear icon, top right).</p>
    </div>
  )
}
