import type { ComboboxOption } from '@/components/ui/Combobox'
import type { SalesPerson } from '@/lib/types'

/** Combobox option for picking a sales-team member by id — carries their
 *  face so the list rows and the selected value show the person, not just a name. */
export function salesPersonOption(p: SalesPerson): ComboboxOption {
  return { value: p.id, label: p.name, person: { name: p.name, photoUrl: p.photoUrl } }
}
