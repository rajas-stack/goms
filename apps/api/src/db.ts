import { Pool, types } from 'pg'

// DATE (OID 1082) as a raw 'YYYY-MM-DD' string — the default parser returns a
// JS Date, which reintroduces a timezone conversion this app has never had
// (every date field here — isoToday(), Transfer.effectiveDate, etc. — is
// already a plain ISO date string with no time/zone component).
types.setTypeParser(1082, (val) => val)

// NUMERIC (OID 1700) as a JS number instead of pg's default string. Every
// cost/price/quantity field the frontend touches (CommercialSku's 8 cost
// fields + 7 price fields, CommercialBomItem.quantity) is a plain `number`
// there — this is the first phase with NUMERIC columns, so without this
// override every router would need its own per-field Number(...) conversion.
// Money in this app is never so large it risks floating-point precision loss
// at this magnitude (existing frontend arithmetic already uses plain
// `number` throughout — same trade-off, not a new one).
types.setTypeParser(1700, (val) => Number(val))

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })
