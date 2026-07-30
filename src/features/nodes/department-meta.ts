import type { MultiSelectGroup } from '@/components/ui/MultiSelectDropdown'
import type { Opportunity } from '@/lib/types'

/** Sales-ownership roles kept per department. Values are employee ids stored
 *  on the department node's metadata under these keys. */
export const SALES_ROLES: { key: string; label: string }[] = [
  { key: 'salesGeo', label: 'Geo Sales' },
]

/** Default component/product-line options for a work line-item, grouped for
 *  the multiselect: an ungrouped generic section, then AMNEX's own product /
 *  OEM lines (amnex.com/products) under their own header. Editable defaults —
 *  not a closed enum; a "+ Add option" custom value is always kept selectable
 *  (appended to the ungrouped section). */
export const WORK_COMPONENT_GROUPS: MultiSelectGroup[] = [
  {
    label: null,
    options: [
      'Hardware', 'Software', 'Services', 'System Integration', 'AMC',
      'Supply', 'Installation', 'Consulting', 'License', 'Support',
    ],
  },
  {
    label: 'AMNEX products',
    options: [
      'Golden Record', 'IPMP', 'Locomate',
      'Syncnex', 'Rapidgo', 'XUP', 'Elbtros',
      'Outline', 'Spectator', 'IIon', 'Ecokeeper', 'Spotlock',
      'Agrogate', 'Agrogate Finance', 'Croptrack', 'Farmlive', 'Recloud',
      'Nirikshak', 'Eargo', 'Veintex', 'Trackous', 'Portvein', 'Samarth', 'Dairynex',
      'BlocSafe',
      'Other',
    ],
  },
]

/** Flattened, for anything that reads it as a plain list. */
export const WORK_COMPONENTS = WORK_COMPONENT_GROUPS.flatMap((g) => g.options)

export const WORK_VERTICALS = [
  'Traffic', 'Transit (Mobility)', 'Data Fabric & AI', 'Integrated (Smart City)',
  'GIS', 'Agriculture', 'Resource & Utility', 'Cloud', 'Other',
]

/** Currencies a work's value/EMD can be denominated in. */
export const WORK_CURRENCIES: { code: string; label: string }[] = [
  { code: 'INR', label: 'INR (₹)' },
  { code: 'USD', label: 'USD ($)' },
  { code: 'AED', label: 'AED (د.إ)' },
  { code: 'EUR', label: 'EUR (€)' },
  { code: 'GBP', label: 'GBP (£)' },
]

/** Scale a work's value/EMD amount is expressed in. */
export const WORK_VALUE_UNITS: { key: string; label: string }[] = [
  { key: 'cr', label: 'Cr' },
  { key: 'lakh', label: 'Lakh' },
  { key: 'thousand', label: 'Thousand' },
]

/** Conservative EMD-as-percent-of-contract-value band seen on GEM/government
 *  tenders — used to derive a budget range from just the EMD amount, since
 *  the exact percent isn't asked for anymore. A lower assumed percent implies
 *  a larger contract value, so the low/high percent bounds invert into
 *  high/low budget bounds. */
const EMD_PERCENT_RANGE = { low: 2, high: 5 }

/** Read-only derived budget range from an EMD amount, in the same unit the
 *  EMD was entered in. `null` until the amount parses as a positive number,
 *  so the caller can hide the estimate rather than show a bogus range. */
export function estimateBudgetRangeFromEmd(emdAmount: string): { low: number; high: number } | null {
  const amount = Number(emdAmount)
  if (!(amount > 0)) return null
  return {
    low: amount * (100 / EMD_PERCENT_RANGE.high),
    high: amount * (100 / EMD_PERCENT_RANGE.low),
  }
}

export function workUnitLabel(key: string): string {
  return WORK_VALUE_UNITS.find((u) => u.key === key)?.label ?? key
}

/** Each unit's size relative to "thousand" (1 Lakh = 100 Thousand, 1 Cr = 100
 *  Lakh = 10,000 Thousand) — the Indian numbering scale `WORK_VALUE_UNITS`
 *  uses. */
const WORK_VALUE_UNIT_FACTORS: Record<string, number> = { thousand: 1, lakh: 100, cr: 10000 }

/** Converts a value/EMD amount from one `WORK_VALUE_UNITS` scale to another,
 *  preserving the actual monetary figure — e.g. "50" Lakh → "0.5" Cr — so
 *  switching the unit dropdown never silently changes what was entered.
 *  Blank/non-numeric input passes through unchanged. */
export function convertWorkAmount(amount: string, fromUnit: string, toUnit: string): string {
  const n = Number(amount)
  if (!amount.trim() || !Number.isFinite(n)) return amount
  const fromFactor = WORK_VALUE_UNIT_FACTORS[fromUnit] ?? 1
  const toFactor = WORK_VALUE_UNIT_FACTORS[toUnit] ?? 1
  return String(Number((n * (fromFactor / toFactor)).toFixed(6)))
}

/** Display string for a work's value, e.g. "INR 50 Lakh" — empty until an
 *  amount has been entered. */
export function formatWorkValue(w: Pick<Opportunity, 'currency' | 'valueAmount' | 'valueUnit'>): string {
  if (!w.valueAmount) return ''
  return `${w.currency} ${w.valueAmount} ${workUnitLabel(w.valueUnit)}`
}

/** `estimateBudgetRangeFromEmd`'s range, rescaled into Cr once its high end
 *  would otherwise read as more than 99 Lakh (e.g. "40–150 Lakh" becomes
 *  "0.4–1.5 Cr") — matches how these figures are normally read/spoken in
 *  Indian usage. Never demotes an already-Cr range. `null` under the same
 *  conditions `estimateBudgetRangeFromEmd` returns null. */
export function estimateBudgetRangeDisplay(emdAmount: string, emdUnit: string): { low: number; high: number; unit: string } | null {
  const range = estimateBudgetRangeFromEmd(emdAmount)
  if (!range) return null
  const fromFactor = WORK_VALUE_UNIT_FACTORS[emdUnit] ?? 1
  const highInLakh = (range.high * fromFactor) / WORK_VALUE_UNIT_FACTORS.lakh
  const unit = emdUnit !== 'cr' && highInLakh > 99 ? 'cr' : emdUnit
  const scale = fromFactor / (WORK_VALUE_UNIT_FACTORS[unit] ?? 1)
  return { low: range.low * scale, high: range.high * scale, unit }
}

/** Display string for the EMD-derived budget range, e.g. "≈ 40–100 Lakh" —
 *  empty until the EMD amount parses as a positive number. */
export function formatBudgetRange(w: Pick<Opportunity, 'emdAmount' | 'emdUnit'>): string {
  const display = estimateBudgetRangeDisplay(w.emdAmount, w.emdUnit)
  if (!display) return ''
  return `≈ ${Number(display.low.toFixed(2))}–${Number(display.high.toFixed(2))} ${workUnitLabel(display.unit)}`
}

const ABBREVIATION_STOPWORDS = new Set(['of', 'and', 'the', 'for', 'in', 'to', '&'])

/** Auto-derived department abbreviation in the style of real ministry
 *  short names (MoSPI, DoT, …) — every word contributes its first letter,
 *  capitalized for a significant word and lowercase for a minor connector
 *  (of/and/the/for/in/to/&), e.g. "Department of National Agencies" →
 *  "DoNA". Used wherever a department's short name is shown and none has
 *  been entered by hand, so departments never need one typed in just to
 *  get a usable abbreviation. */
export function abbreviateDepartmentName(name: string): string {
  return name
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((w) => (ABBREVIATION_STOPWORDS.has(w.toLowerCase()) ? w[0].toLowerCase() : w[0].toUpperCase()))
    .filter((c) => /[A-Za-z]/.test(c))
    .join('')
}

