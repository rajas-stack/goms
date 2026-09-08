/** Department contact metadata stores a list of numbers under one plain
 *  string key (`metadata.contactNumbers`), JSON-encoded — metadata values
 *  are `Record<string,string>` (JSONB both sides), so a list needs
 *  serializing rather than indexed keys (`contact1`, `contact2`, ...), which
 *  would be harder to add/remove from cleanly. */

/** '' means "not yet chosen" — a row mid-way through the State → Type →
 *  (District → City → STD → Number) reveal flow. A row loaded from
 *  storage only ever has '' here if its JSON explicitly said so (see
 *  `normalizeType`) — an older record that predates this field entirely
 *  defaults to 'landline' instead, since every entry back then always
 *  carried city/STD-code semantics. */
export type ContactNumberType = 'landline' | 'mobile' | ''

export interface ContactNumberEntry {
  type: ContactNumberType
  /** This row's own State/District org-node ids — each contact number owns
   *  its geography independently (one department can have offices/numbers
   *  in more than one state/district). */
  stateNodeId: string
  districtNodeId: string
  city: string
  stdCode: string
  number: string
}

const EMPTY: ContactNumberEntry[] = []

function normalizeType(value: unknown): ContactNumberType {
  if (value === 'mobile' || value === 'landline') return value
  if (value === undefined) return 'landline'
  return ''
}

/** Parses `metadata.contactNumbers` back into a list. Never throws — an
 *  empty/missing/malformed value degrades to an empty list rather than
 *  breaking the form.
 *
 *  `legacyStateNodeId`/`legacyDistrictNodeId` are the department's old
 *  section-level `metadata.contactStateNodeId`/`contactDistrictNodeId`
 *  (from before each row owned its own geography) — any entry whose own
 *  `stateNodeId`/`districtNodeId` is absent falls back to these, so an
 *  older saved department keeps showing/working exactly as before without
 *  the user having to re-pick anything. A row that legitimately has no
 *  state of its own (Central Ministries, or a department whose old
 *  section-level fields were also never set) simply falls back to '' —
 *  the same "not yet chosen" state a brand-new row starts in. */
export function parseContactNumbers(
  raw: string | undefined,
  legacyStateNodeId = '',
  legacyDistrictNodeId = '',
): ContactNumberEntry[] {
  if (!raw) return EMPTY
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return EMPTY
    return parsed
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e) => ({
        type: normalizeType(e.type),
        stateNodeId: typeof e.stateNodeId === 'string' && e.stateNodeId ? e.stateNodeId : legacyStateNodeId,
        districtNodeId: typeof e.districtNodeId === 'string' && e.districtNodeId ? e.districtNodeId : legacyDistrictNodeId,
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
