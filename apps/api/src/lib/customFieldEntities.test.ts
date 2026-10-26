import { describe, expect, it } from 'vitest'
import { coerceCustomValue } from '@goms/domain'
import { assertEntityExists, auditDisplay } from './customFieldEntities.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const people: Record<string, string> = { [A]: 'Asha Rao', [B]: 'Ravi Shah' }
// Stands in for Postgres: answers the sales_persons lookup from `people`.
const client = {
  query: async (_sql: string, params?: unknown[]) => ({
    rows: (params?.[0] as string[]).filter((id) => people[id]).map((id) => ({ id, name: people[id] })),
  }),
}

describe('multi-person custom values (API validation)', () => {
  it('accepts a list of existing people and audits their names', async () => {
    const value = coerceCustomValue('person', JSON.stringify([A, B]))
    await expect(assertEntityExists(client, 'person', value)).resolves.toBeUndefined()
    expect(await auditDisplay(client, 'person', value)).toBe('Asha Rao, Ravi Shah')
  })

  it('still accepts one person stored as a plain id', async () => {
    expect(await auditDisplay(client, 'person', coerceCustomValue('person', JSON.stringify([A])))).toBe('Asha Rao')
  })

  it('rejects a list with anyone who does not exist', async () => {
    await expect(assertEntityExists(client, 'person', JSON.stringify([A, '33333333-3333-4333-8333-333333333333']))).rejects.toThrow(/person does not exist/)
    await expect(assertEntityExists(client, 'person', JSON.stringify([A, 'not-a-uuid']))).rejects.toThrow(/person does not exist/)
  })
})
