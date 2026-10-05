import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { primaryOfficeAddress, parseOfficeLocations, serializeOfficeLocations, type OfficeLocation } from './office-locations'

interface Props {
  meta: Record<string, string>
  setMeta: (updater: (metadata: Record<string, string>) => Record<string, string>) => void
}

function newLocation(index: number): OfficeLocation {
  const id = globalThis.crypto?.randomUUID?.() ?? `office-${Date.now()}-${index}`
  return { id, label: index === 0 ? 'Main office' : `Branch office ${index}`, address: '' }
}

export function OfficeLocationsField({ meta, setMeta }: Props) {
  const locations = parseOfficeLocations(meta.officeAddresses, meta.officeAddress)

  function update(next: OfficeLocation[]) {
    const officeAddresses = serializeOfficeLocations(next)
    const officeAddress = primaryOfficeAddress(next)
    setMeta((current) => {
      const updated = { ...current }
      if (next.length) updated.officeAddresses = officeAddresses
      else delete updated.officeAddresses
      if (officeAddress) updated.officeAddress = officeAddress
      else delete updated.officeAddress
      return updated
    })
  }

  return (
    <section aria-label="Office and branch locations" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-ink-800">Office and branch locations</h3>
          <p className="mt-0.5 text-[11px] text-muted">Keep each address under a clear office or branch name.</p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => update([...locations, newLocation(locations.length)])}>
          <Icon name="Plus" size={13} /> Add location
        </Button>
      </div>
      {locations.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[12px] text-muted">No office locations added.</p>
      ) : (
        <div className="space-y-3">
          {locations.map((location, index) => (
            <section key={location.id} aria-label={`${location.label || `Location ${index + 1}`}`} className="rounded-lg border border-line bg-panel/40 p-3">
              <div className="mb-3 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <Field label="Office or branch name">
                    <Input
                      aria-label="Office or branch name"
                      value={location.label}
                      onChange={(event) => update(locations.map((item) => item.id === location.id ? { ...item, label: event.target.value } : item))}
                      placeholder="e.g. Main office, Ahmedabad branch"
                    />
                  </Field>
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${location.label || `location ${index + 1}`}`} onClick={() => update(locations.filter((item) => item.id !== location.id))}>
                  <Icon name="X" size={15} />
                </Button>
              </div>
              <Field label="Address">
                <Textarea
                  aria-label="Address"
                  value={location.address}
                  onChange={(event) => update(locations.map((item) => item.id === location.id ? { ...item, address: event.target.value } : item))}
                  placeholder="Street, area, city, state, PIN code"
                />
              </Field>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}