import { AMNEX_ID_PREFIX, parseEmployeeNumber } from '@goms/domain'
import { Field, Input } from '@/components/ui/Field'

/** Amnex ID entry: the AIPL_ prefix is fixed, only the employee number is typed. Leading zeros are kept;
 *  a pasted "AIPL_0123" keeps just its digits. */
export function EmployeeNumberField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label="Employee ID" hint="Amnex employee number. Must be unique; leading zeros are kept.">
      <div className="flex items-stretch">
        <span className="flex items-center rounded-l-lg border border-r-0 border-line bg-panel px-2.5 font-mono text-[13px] text-muted" aria-hidden="true">{AMNEX_ID_PREFIX}</span>
        <Input
          aria-label="Employee number" inputMode="numeric" value={value} placeholder="1234" className="rounded-l-none font-mono"
          onChange={(ev) => onChange(parseEmployeeNumber(ev.target.value) ?? ev.target.value.replace(/\D/g, ''))}
        />
      </div>
    </Field>
  )
}
