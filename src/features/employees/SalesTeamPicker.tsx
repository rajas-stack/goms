import { Combobox } from '@/components/ui/Combobox'
import { SALES_TEAM } from '@/data/sales-team'

/** Picks an AMNEX sales-team member (by email, the roster's unique key) to
 *  assign as the relationship owner for a department or a specific position.
 *  Distinct from EmployeePicker: candidates come from AMNEX's own roster
 *  (src/data/sales-team.ts), never from government Employee records. */
export function SalesTeamPicker({ value, onChange, disabled }: {
  value: string
  onChange: (email: string) => void
  /** Renders a read-only value instead of the editable picker — for fields
   *  derived from another selection (e.g. RM/GM/Sales Head). */
  disabled?: boolean
}) {
  const options = SALES_TEAM.map((m) => ({ value: m.email, label: `${m.name} · ${m.designation}` }))
  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      placeholder="Unassigned"
      aria-label="Relationship owner / AMNEX representative"
      disabled={disabled}
    />
  )
}
