/** Department contact metadata stores a list of numbers under one plain
 *  string key (`metadata.contactNumbers`), JSON-encoded — metadata values
 *  are `Record<string,string>` (JSONB both sides), so a list needs
 *  serializing rather than indexed keys (`contact1`, `contact2`, ...), which
 *  would be harder to add/remove from cleanly. */

export type ContactNumberType = 'landline' | 'mobile'

export interface ContactNumberEntry {
  /** 'landline' (City/STD/local-number, no +91) vs 'mobile' (+91 + 10-digit
   *  number, no STD) — these are different domestic dialing representations
   *  and must never be shown/concatenated together. Missing/invalid on an
   *  older stored entry defaults to 'landline' (see `normalizeType`) since
   *  every entry predating this field always carried city/STD-code
   *  semantics. */
  type: ContactNumberType
  city: string
  stdCode: string
  number: string
}

const EMPTY: ContactNumberEntry[] = []

function normalizeType(value: unknown): ContactNumberType {
  return value === 'mobile' ? 'mobile' : 'landline'
}

/** Parses `metadata.contactNumbers` back into a list. Never throws — an
 *  empty/missing/malformed value degrades to an empty list rather than
 *  breaking the form. */
export function parseContactNumbers(raw: string | undefined): ContactNumberEntry[] {
  if (!raw) return EMPTY
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return EMPTY
    return parsed
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e) => ({
        type: normalizeType(e.type),
        city: typeof e.city === 'string' ? e.city : '',
        stdCode: typeof e.stdCode === 'string' ? e.stdCode : '',
        number: typeof e.number === 'string' ? e.number : '',
      }))
  } catch {
    return EMPTY
  }
}

export function serializeContactNumbers(entries: ContactNumberEntry[]): string {
  return JSON.stringify(entries)
}
