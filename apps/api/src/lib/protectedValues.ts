// Spec §13 — one shared guard, called from every direct-edit path AND the
// corrigendum-accept path AND the admin-import commit pipeline, so "never
// silently overwritten" is enforced identically everywhere rather than
// reimplemented per call site with room to drift.
import { TRPCError } from '@trpc/server'
import { PROTECTED_VALUES_ENFORCED } from '@goms/domain'

export async function assertFieldsNotProtected(
  client: { query: (sql: string, params?: unknown[]) => Promise<any> },
  entityType: string,
  entityId: string,
  fieldKeys: string[],
): Promise<void> {
  if (!fieldKeys.length) return
  const result = await client.query(
    `SELECT field_key FROM protected_values WHERE entity_type=$1 AND entity_id=$2 AND field_key = ANY($3) AND frozen=true`,
    [entityType, entityId, fieldKeys],
  )
  if (result.rows.length) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `"${result.rows[0].field_key}" is protected — unfreeze it first.`,
    })
  }
}
