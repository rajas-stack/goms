import { afterEach, describe, expect, it } from 'vitest'
import { pool } from '../../db.js'

afterEach(async () => {
  await pool.query(`DELETE FROM user_role_overrides WHERE email LIKE 'rbac-mig-%'`)
})

const insert = (email: string, role: string, effect = 'grant', reason = 'test') =>
  pool.query(
    `INSERT INTO user_role_overrides (email, role, effect, reason, created_by) VALUES ($1,$2,$3,$4,'tester@amnex.com')`,
    [email, role, effect, reason],
  )

describe('user_role_overrides', () => {
  it('accepts a valid grant and a valid revoke', async () => {
    await insert('rbac-mig-a@amnex.com', 'cxo', 'grant')
    await insert('rbac-mig-a@amnex.com', 'legal', 'revoke')
    const { rows } = await pool.query(`SELECT role, effect FROM user_role_overrides WHERE email='rbac-mig-a@amnex.com' ORDER BY role`)
    expect(rows).toEqual([{ role: 'cxo', effect: 'grant' }, { role: 'legal', effect: 'revoke' }])
  })
  it('rejects an unknown role, an unknown effect and an empty reason', async () => {
    await expect(insert('rbac-mig-b@amnex.com', 'admin')).rejects.toThrow(/check/i)
    await expect(insert('rbac-mig-b@amnex.com', 'cxo', 'allow')).rejects.toThrow(/check/i)
    await expect(insert('rbac-mig-b@amnex.com', 'cxo', 'grant', '   ')).rejects.toThrow(/check/i)
  })
  it('stores emails lower-cased only', async () => {
    await expect(insert('RBAC-MIG-C@amnex.com', 'cxo')).rejects.toThrow(/check/i)
  })
  it('allows at most one row per (email, role)', async () => {
    await insert('rbac-mig-d@amnex.com', 'cxo')
    await expect(insert('rbac-mig-d@amnex.com', 'cxo', 'revoke')).rejects.toThrow(/unique|duplicate/i)
  })
})

describe('created_by columns', () => {
  it.each(['opportunities', 'timeline_events', 'follow_ups'])('%s has a nullable created_by', async (table) => {
    const { rows } = await pool.query(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name=$1 AND column_name='created_by'`, [table],
    )
    expect(rows[0]?.is_nullable).toBe('YES')
  })
})
