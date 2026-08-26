import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../../db.js'
import { validateSalesRosterRows, commitSalesRosterRows } from './salesRoster.js'

describe('salesRoster importer', () => {
  beforeEach(async () => {
    // sales_postings.sales_person_id references sales_persons ON DELETE
    // CASCADE (1787639705341_sales.sql:23), so deleting sales_persons
    // clears both tables in one statement.
    await pool.query(`DELETE FROM sales_persons`)
  })

  it('rejects a posting with a Tier Key not in SALES_TIERS', async () => {
    const persons = [{ officialEmail: 'a@amnex.com', name: 'A', personalEmail: '', mobile: '', altMobile: '', joinedOn: null, status: 'active' }]
    const postings = [{ salesPersonEmail: 'a@amnex.com', designation: 'X', tierKey: 'madeUpTier', managerEmail: null, office: '', startDate: '2026-01-01', reason: '' }]
    const preview = await validateSalesRosterRows(pool, { persons, postings })
    expect(preview.postings[0].action).toBe('reject')
    expect(preview.postings[0].errors[0]).toMatch(/tier key/i)
  })

  it('creates a Sales Person and their initial posting together', async () => {
    const persons = [{ officialEmail: 'b@amnex.com', name: 'B', personalEmail: '', mobile: '', altMobile: '', joinedOn: null, status: 'active' }]
    const postings = [{ salesPersonEmail: 'b@amnex.com', designation: 'Account Manager', tierKey: 'accountManager', managerEmail: null, office: 'Mumbai', startDate: '2026-01-01', reason: '' }]

    const preview = await validateSalesRosterRows(pool, { persons, postings })
    expect(preview.persons[0].action).toBe('create')
    expect(preview.postings[0].action).toBe('create')

    await commitSalesRosterRows(pool, { persons, postings }, preview)

    const personRow = (await pool.query(`SELECT * FROM sales_persons WHERE official_email='b@amnex.com'`)).rows[0]
    expect(personRow).toBeTruthy()
    expect(personRow.name).toBe('B')

    const postingRow = (await pool.query(`SELECT * FROM sales_postings WHERE sales_person_id=$1`, [personRow.id])).rows[0]
    expect(postingRow).toBeTruthy()
    expect(postingRow.tier_key).toBe('accountManager')
    expect(postingRow.change_type).toBe('initial')
    expect(postingRow.end_date).toBeNull()
  })

  it('a second import of the identical open posting is classified unchanged, not a duplicate create', async () => {
    const persons = [{ officialEmail: 'c@amnex.com', name: 'C', personalEmail: '', mobile: '', altMobile: '', joinedOn: null, status: 'active' }]
    const postings = [{ salesPersonEmail: 'c@amnex.com', designation: 'Account Manager', tierKey: 'accountManager', managerEmail: null, office: '', startDate: '2026-01-01', reason: '' }]

    const firstPreview = await validateSalesRosterRows(pool, { persons, postings })
    await commitSalesRosterRows(pool, { persons, postings }, firstPreview)

    const secondPreview = await validateSalesRosterRows(pool, { persons, postings })
    expect(secondPreview.persons[0].action).toBe('unchanged')
    expect(secondPreview.postings[0].action).toBe('unchanged')

    const count = await pool.query(`SELECT COUNT(*) FROM sales_postings`)
    expect(Number(count.rows[0].count)).toBe(1)
  })

  it('rejects an attempt to change a field on an already-closed historical posting', async () => {
    const persons = [{ officialEmail: 'd@amnex.com', name: 'D', personalEmail: '', mobile: '', altMobile: '', joinedOn: null, status: 'active' }]
    const firstPostings = [{ salesPersonEmail: 'd@amnex.com', designation: 'Account Manager', tierKey: 'accountManager', managerEmail: null, office: '', startDate: '2026-01-01', reason: '' }]
    const firstPreview = await validateSalesRosterRows(pool, { persons, postings: firstPostings })
    await commitSalesRosterRows(pool, { persons, postings: firstPostings }, firstPreview)

    // A later promotion closes the first posting, turning it into history.
    const secondPostings = [{ salesPersonEmail: 'd@amnex.com', designation: 'Regional Manager', tierKey: 'rm', managerEmail: null, office: '', startDate: '2026-06-01', reason: 'promotion' }]
    const secondPreview = await validateSalesRosterRows(pool, { persons: [], postings: secondPostings })
    await commitSalesRosterRows(pool, { persons: [], postings: secondPostings }, secondPreview)

    // Re-uploading the now-closed first posting with a changed field must be rejected, not patched.
    const modifiedFirst = [{ ...firstPostings[0], designation: 'Changed Designation' }]
    const thirdPreview = await validateSalesRosterRows(pool, { persons: [], postings: modifiedFirst })
    expect(thirdPreview.postings[0].action).toBe('reject')
    expect(thirdPreview.postings[0].errors).toContain('cannot modify closed posting history via import')
  })

  it("commit closes the prior open posting's end_date when a new posting with a later Start Date is committed for the same person", async () => {
    const persons = [{ officialEmail: 'e@amnex.com', name: 'E', personalEmail: '', mobile: '', altMobile: '', joinedOn: null, status: 'active' }]
    const firstPostings = [{ salesPersonEmail: 'e@amnex.com', designation: 'Account Manager', tierKey: 'accountManager', managerEmail: null, office: '', startDate: '2026-01-01', reason: '' }]
    const firstPreview = await validateSalesRosterRows(pool, { persons, postings: firstPostings })
    await commitSalesRosterRows(pool, { persons, postings: firstPostings }, firstPreview)

    const secondPostings = [{ salesPersonEmail: 'e@amnex.com', designation: 'Regional Manager', tierKey: 'rm', managerEmail: null, office: '', startDate: '2026-06-01', reason: 'promotion' }]
    const secondPreview = await validateSalesRosterRows(pool, { persons: [], postings: secondPostings })
    expect(secondPreview.postings[0].action).toBe('create')
    await commitSalesRosterRows(pool, { persons: [], postings: secondPostings }, secondPreview)

    const person = (await pool.query(`SELECT id FROM sales_persons WHERE official_email='e@amnex.com'`)).rows[0]
    const allPostings = (await pool.query(`SELECT * FROM sales_postings WHERE sales_person_id=$1 ORDER BY start_date ASC`, [person.id])).rows
    expect(allPostings).toHaveLength(2)
    // mirrors sales.ts:138 — the prior open posting's end_date is set to the new posting's start_date.
    expect(allPostings[0].end_date).toBe('2026-06-01')
    expect(allPostings[1].end_date).toBeNull()
    // accountManager (rank 4) -> rm (rank 3): a lower rank number is more senior, so this is a promotion.
    expect(allPostings[1].change_type).toBe('promotion')
  })

  it('resolves Manager Email against another Sales Person row in the same file', async () => {
    const persons = [
      { officialEmail: 'mgr@amnex.com', name: 'Manager', personalEmail: '', mobile: '', altMobile: '', joinedOn: null, status: 'active' },
      { officialEmail: 'rep@amnex.com', name: 'Rep', personalEmail: '', mobile: '', altMobile: '', joinedOn: null, status: 'active' },
    ]
    const postings = [
      { salesPersonEmail: 'mgr@amnex.com', designation: 'Regional Manager', tierKey: 'rm', managerEmail: null, office: '', startDate: '2026-01-01', reason: '' },
      { salesPersonEmail: 'rep@amnex.com', designation: 'Account Manager', tierKey: 'accountManager', managerEmail: 'mgr@amnex.com', office: '', startDate: '2026-01-01', reason: '' },
    ]

    const preview = await validateSalesRosterRows(pool, { persons, postings })
    expect(preview.postings.every((r) => r.action !== 'reject')).toBe(true)

    await commitSalesRosterRows(pool, { persons, postings }, preview)

    const rep = (await pool.query(
      `SELECT mgr.official_email AS manager_email
       FROM sales_postings sp
       JOIN sales_persons per ON per.id = sp.sales_person_id
       LEFT JOIN sales_persons mgr ON mgr.id = sp.manager_id
       WHERE per.official_email='rep@amnex.com'`,
    )).rows[0]
    expect(rep.manager_email).toBe('mgr@amnex.com')
  })
})
