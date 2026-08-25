import { Pool, types } from 'pg'

// DATE (OID 1082) as a raw 'YYYY-MM-DD' string — the default parser returns a
// JS Date, which reintroduces a timezone conversion this app has never had
// (every date field here — isoToday(), Transfer.effectiveDate, etc. — is
// already a plain ISO date string with no time/zone component).
types.setTypeParser(1082, (val) => val)

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })
