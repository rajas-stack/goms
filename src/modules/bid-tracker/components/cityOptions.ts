import adminRaw from '@/data/india-admin.json'
import type { ColumnOption } from '../gridColumns'

const STATES = adminRaw as unknown as { st_code: string; districts: { district: string }[] }[]

/** The City pick-list for a row in this State: its LGD districts (the bundled reference data both data
 *  layers seed from), plus the cell's own value when it is a city typed in by hand. */
export function citiesOf(stateCode: number | null | undefined, current = ''): ColumnOption[] {
  const districts = STATES.find((s) => Number(s.st_code) === stateCode)?.districts ?? []
  const cities = districts.map((d) => ({ value: d.district, label: d.district })).sort((a, b) => a.label.localeCompare(b.label))
  return current && !cities.some((c) => c.value === current) ? [{ value: current, label: current }, ...cities] : cities
}
