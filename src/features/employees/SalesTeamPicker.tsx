import { Combobox } from '@/components/ui/Combobox'
import { useCurrentPostings, useSalesPersons } from '@/lib/api'

/** Picks an AMNEX sales-team member (by email, the roster's unique key) to
 *  assign as the relationship owner for a department or a specific position.
 *  Distinct from EmployeePicker: candidates come from AMNEX's own live sales
 *  roster (the Sales Team tab's `SalesPerson` records), not the static
 *  `SALES_TEAM` seed constant — so a rename, a new hire, or someone removed
 *  there is reflected here immediately, not just in the Sales Team tab. */
export function SalesTeamPicker({ value, onChange, disabled, ariaLabel }: {
  value: string
  onChange: (email: string) => void
  /** Renders a read-only value instead of the editable picker — for fields
   *  derived from another selection (e.g. RM/GM/Sales Head). */
  disabled?: boolean
  /** Accessible name for the control. Defaults to this picker's original
   *  context (Relationship Owner) so existing callers are unaffected — pass
   *  one matching the surrounding Field's visible label (e.g. "Reporting
   *  Manager (RM)", "Sales person") wherever this is reused for a different
   *  field, so the two never diverge for a screen reader user. */
  ariaLabel?: string
}) {
  const { data: salesPersons = [] } = useSalesPersons()
  const { data: currentPostings = {} } = useCurrentPostings()
  const options = salesPersons.map((p) => ({
    value: p.officialEmail,
    label: `${p.name} · ${currentPostings[p.id]?.designation || 'No current posting'}`,
  }))
  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      placeholder="Unassigned"
      aria-label={ariaLabel ?? 'Relationship owner / AMNEX representative'}
      disabled={disabled}
    />
  )
}
