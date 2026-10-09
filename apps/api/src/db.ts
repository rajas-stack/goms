import { Pool, types } from 'pg'
import { productionSecurity } from './security/config.js'

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

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(productionSecurity() ? { statement_timeout: 30000, query_timeout: 35000, idle_in_transaction_session_timeout: 30000 } : {}),
  // Unset, `pg.Pool` defaults to max: 10 with no connection timeout — fine
  // in isolation, but Cloud Run's own default concurrency (80 requests/
  // instance) means a burst of concurrent mutations could ask for far more
  // simultaneous pool clients than 10, and each one would wait indefinitely
  // rather than failing fast. `max: 8` leaves headroom under Cloud SQL's own
  // connection ceiling for `db-f1-micro` (~25 total, shared across however
  // many Cloud Run instances are live) — 8 per instance keeps a handful of
  // concurrently-scaled instances well under that ceiling, tune upward only
  // alongside a real instance-tier/connection-ceiling change, not by default.
  // `connectionTimeoutMillis` turns "no client available" into a clear,
  // bounded error instead of a request hanging forever if the pool is ever
  // saturated.
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})
