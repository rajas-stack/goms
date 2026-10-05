import { TRPCError } from '@trpc/server'
import { formatOpportunityCode, opportunityCodeParts, type OpportunityCodeInput } from '@goms/domain'
import type { Queryable } from './hierarchyNodes.js'

/** `created_at` is a DATE column, which node-pg hands back as a local-midnight
 *  `Date` — read its calendar fields directly so no timezone shift moves it. */
function dateText(value: unknown): string {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  return value == null ? '' : String(value)
}

/** The Opportunity ID inputs of an `opportunities` row joined to its department. */
export function opportunityCodeInputFromRow(row: any): OpportunityCodeInput {
  return {
    submissionDate: row.submission_date, createdAt: dateText(row.created_at), vertical: row.vertical,
    stateCode: row.state_code, opportunityType: row.opportunity_type, component: row.component ?? [],
    department: row.department_name ? { shortName: row.department_short_name, name: row.department_name } : null,
  }
}

/** Next number of a fiscal year's counter — the same atomic upsert as bid codes
 *  (bids.ts allocateBidCode): the row lock it takes serializes concurrent
 *  allocations, so two transactions can never draw the same number. */
async function nextSequence(client: Queryable, fiscalYear: string): Promise<number> {
  const result = await client.query(
    `INSERT INTO opportunity_code_sequences (fiscal_year, next_value) VALUES ($1, 2)
     ON CONFLICT (fiscal_year) DO UPDATE SET next_value = opportunity_code_sequences.next_value + 1
     RETURNING next_value - 1 AS allocated`,
    [fiscalYear],
  )
  return Number(result.rows[0].allocated)
}

/** Gives an opportunity its Opportunity ID, on the CALLER's transaction. Only
 *  ever fills a NULL code — an assigned code is locked and is returned as is.
 *  Must run once the row's department/state are final (bids.create resolves
 *  a new opportunity's department after inserting it). A number already used
 *  by a code of the same fiscal year (e.g. one written before the counter
 *  existed) is skipped; the UNIQUE column is the last-line guard. */
export async function assignOpportunityCode(client: Queryable, opportunityId: string): Promise<string> {
  const row = (await client.query(
    `SELECT o.*, d.name AS department_name, d.metadata->>'shortName' AS department_short_name
     FROM opportunities o LEFT JOIN hierarchy_nodes d ON d.id = o.department_id
     WHERE o.id=$1 FOR UPDATE OF o`,
    [opportunityId],
  )).rows[0]
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: `No such opportunity: ${opportunityId}` })
  if (row.opportunity_code) return row.opportunity_code
  const parts = opportunityCodeParts(opportunityCodeInputFromRow(row))
  let code: string
  for (;;) {
    const seq = await nextSequence(client, parts.fiscalYear)
    code = formatOpportunityCode(parts.prefix, seq)
    const clash = (await client.query(
      `SELECT 1 FROM opportunities WHERE opportunity_code LIKE $1 || '-%' AND opportunity_code ~ ('-' || $2 || '$') LIMIT 1`,
      [parts.fiscalYear, String(seq)],
    )).rows[0]
    if (!clash) break
  }
  await client.query('UPDATE opportunities SET opportunity_code=$1 WHERE id=$2', [code, opportunityId])
  return code
}
