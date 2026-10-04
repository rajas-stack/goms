import { Combobox } from '@/components/ui/Combobox'
import { Field } from '@/components/ui/Field'
import { useDeliveryTeamMembers, useSalesPersons } from '@/lib/api'
import type { Opportunity } from '@/lib/types'

const ASSIGNMENT_FIELDS = [
  { key: 'geoSalesPersonId', label: 'Geo-sales', team: 'sales' },
  { key: 'buSalesPersonId', label: 'BU-sales', team: 'sales' },
  { key: 'preSalesPersonId', label: 'Pre-sales', team: 'preSales' },
  { key: 'legalPersonId', label: 'Legal', team: 'legal' },
  { key: 'bidTeamMemberId', label: 'Bid', team: 'bid' },
] as const

type AssignmentKey = typeof ASSIGNMENT_FIELDS[number]['key']
type AssignmentValues = Pick<Opportunity, AssignmentKey>

export function OpportunityTeamAssignments({ value, onChange }: {
  value: AssignmentValues
  onChange: (key: AssignmentKey, id: string | null) => void
}) {
  const { data: salesPeople = [] } = useSalesPersons()
  const { data: deliveryMembers = [] } = useDeliveryTeamMembers()
  const options = {
    sales: salesPeople.filter((person) => person.status === 'active').map((person) => ({ value: person.id, label: person.name })),
    preSales: deliveryMembers.filter((person) => person.team === 'preSales' && person.status === 'active').map((person) => ({ value: person.id, label: person.name })),
    legal: deliveryMembers.filter((person) => person.team === 'legal' && person.status === 'active').map((person) => ({ value: person.id, label: person.name })),
    bid: deliveryMembers.filter((person) => person.team === 'bid' && person.status === 'active').map((person) => ({ value: person.id, label: person.name })),
  }

  return (
    <section aria-label="Opportunity team assignments" className="space-y-3 rounded-lg border border-line bg-panel/40 p-3 sm:col-span-2">
      <div>
        <h3 className="text-[13px] font-semibold text-ink-800">Opportunity team</h3>
        <p className="mt-0.5 text-[11px] text-muted">Assign the people responsible for this opportunity.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ASSIGNMENT_FIELDS.map((field) => (
          <Field key={field.key} label={field.label}>
            <Combobox
              aria-label={field.label}
              value={value[field.key] ?? ''}
              onChange={(id) => onChange(field.key, id || null)}
              options={options[field.team]}
              placeholder={`Select ${field.label.toLowerCase()}…`}
            />
          </Field>
        ))}
      </div>
    </section>
  )
}
