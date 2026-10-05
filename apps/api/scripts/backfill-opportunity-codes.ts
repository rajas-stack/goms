// One-off backfill of the human-readable Opportunity ID (opportunities.opportunity_code,
// added by migrations/1790400000000_opportunity-code.sql) for rows created before it existed.
//
// Gives every opportunity whose code is NULL one, in creation order (created_at, then id), from
// the same per-fiscal-year counter (opportunity_code_sequences) and the same builder
// (packages/domain/src/opportunityCode.ts) new opportunities use. Rows that already have a code
// are never touched — the code is locked once assigned — so re-running is a safe no-op. Runs in
// ONE transaction: any failure rolls the whole backfill back.
//
// Run AFTER the migration, with the domain package built:
//   npm run build --workspace @goms/domain
//   cd apps/api && npx tsx --env-file=.env.local scripts/backfill-opportunity-codes.ts
// Add --dry-run to print what would be assigned and roll back instead of committing.
import { pool } from '../src/db.js'
import { assignOpportunityCode } from '../src/lib/opportunityCode.js'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const pending = (await client.query(
      'SELECT id, opportunity_name FROM opportunities WHERE opportunity_code IS NULL ORDER BY created_at, id',
    )).rows
    for (const row of pending) {
      const code = await assignOpportunityCode(client, row.id)
      console.log(`${code}\t${row.opportunity_name}`)
    }
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT')
    console.log(`${dryRun ? 'Dry run — would assign' : 'Assigned'} ${pending.length} opportunity code(s).`)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
