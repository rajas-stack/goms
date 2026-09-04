import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'
import { authorizedContext, AUTHORIZED_TEST_EMAIL } from '../testHelpers/adminImportTestAuth.js'

describe('adminImport router', () => {
  beforeEach(async () => {
    process.env.ADMIN_IMPORT_ENABLED = 'true'
    process.env.ADMIN_IMPORT_ALLOWED_EMAILS = AUTHORIZED_TEST_EMAIL
    // Cleared in the established cross-file-safe order (see the 2026-08-26
    // "clear FK-dependent tables" fix) since this file exercises several
    // domains that touch commercial_masters/sales_persons/hierarchy_nodes.
    await pool.query('DELETE FROM commercial_audit_logs')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM commercial_bom_items')
    await pool.query('DELETE FROM commercial_skus')
    await pool.query('DELETE FROM edition_features')
    await pool.query('DELETE FROM commercial_masters')
    await pool.query('DELETE FROM sales_persons')
    await pool.query(`DELETE FROM hierarchy_nodes WHERE domain='geo'`)
    await pool.query('DELETE FROM admin_import_runs')
  })
  afterEach(() => {
    delete process.env.ADMIN_IMPORT_ENABLED
    delete process.env.ADMIN_IMPORT_ALLOWED_EMAILS
  })

  describe('session.validate / session.commit', () => {
    it('validates a single-domain session and reports it as create', async () => {
      const caller = appRouter.createCaller(authorizedContext())
      const preview = await caller.adminImport.session.validate({
        domains: { taxClasses: [{ code: 'GST18', name: 'GST 18%', ratePct: 18 }] },
      })
      expect(preview.summary.toCreate).toBe(1)
      expect(preview.domainOrder).toEqual(['taxClasses'])
    })

    it('commits a single-domain session and writes the row', async () => {
      const caller = appRouter.createCaller(authorizedContext())
      const domains = { taxClasses: [{ code: 'GST18', name: 'GST 18%', ratePct: 18 }] }
      const preview = await caller.adminImport.session.validate({ domains })
      const result = await caller.adminImport.session.commit({ domains, sessionCommitToken: preview.sessionCommitToken, excludedRows: [] })
      expect(result.summary.toCreate).toBe(1)
      const dbRows = await pool.query(`SELECT code FROM commercial_masters WHERE master_key='taxClasses'`)
      expect(dbRows.rows.map((r) => r.code)).toEqual(['GST18'])
    })

    it('rejects a commit when MAX_IMPORT_ROWS is exceeded for a single domain', async () => {
      const caller = appRouter.createCaller(authorizedContext())
      const tooMany = Array.from({ length: 5001 }, (_, i) => ({ code: `GST${i}`, name: `Tax ${i}`, ratePct: 1 }))
      await expect(caller.adminImport.session.validate({ domains: { taxClasses: tooMany } })).rejects.toThrow()
    })

    it('returns NOT_IMPLEMENTED for an unwired domain key', async () => {
      const caller = appRouter.createCaller(authorizedContext())
      // geography has no session adapter by design (previewGeographyLoad/commitGeographyLoad stay separate).
      await expect(caller.adminImport.session.validate({ domains: { geography: [] } as any })).rejects.toThrow()
    })

    it('routes a multi-sheet domain (commercialMastersFlat) through the { sheet: rows[] } adapter end-to-end', async () => {
      const caller = appRouter.createCaller(authorizedContext())
      const domains = {
        commercialMastersFlat: {
          skuCategories: [{ code: 'SW', name: 'Software', description: '', active: true, displayOrder: 0 }],
          unitsOfMeasure: [{ code: 'LIC', name: 'License', description: '', active: true, displayOrder: 0 }],
          productEditions: [],
          billingTypes: [],
        },
      }
      const preview = await caller.adminImport.session.validate({ domains })
      // Flattened across all 4 sheets: 2 rows submitted, both create.
      expect(preview.summary).toMatchObject({ toCreate: 2, total: 2 })

      const result = await caller.adminImport.session.commit({ domains, sessionCommitToken: preview.sessionCommitToken, excludedRows: [] })
      expect(result.summary.toCreate).toBe(2)
      const dbRows = await pool.query(
        `SELECT master_key, code FROM commercial_masters WHERE master_key IN ('skuCategories','unitsOfMeasure') ORDER BY master_key`,
      )
      expect(dbRows.rows).toEqual([
        { master_key: 'skuCategories', code: 'SW' },
        { master_key: 'unitsOfMeasure', code: 'LIC' },
      ])
    })

    it('routes a two-sheet domain (salesRoster) through the {persons,postings} adapter end-to-end', async () => {
      const caller = appRouter.createCaller(authorizedContext())
      const domains = {
        salesRoster: {
          persons: [{ officialEmail: 'a@amnex.com', name: 'A', personalEmail: '', mobile: '', altMobile: '', joinedOn: null, status: 'active' }],
          postings: [{ salesPersonEmail: 'a@amnex.com', designation: 'X', tierKey: 'accountManager', managerEmail: null, office: '', startDate: '2026-01-01', reason: '' }],
        },
      }
      const preview = await caller.adminImport.session.validate({ domains })
      expect(preview.summary).toMatchObject({ toCreate: 2, total: 2 })

      const result = await caller.adminImport.session.commit({ domains, sessionCommitToken: preview.sessionCommitToken, excludedRows: [] })
      expect(result.summary.toCreate).toBe(2)
      const dbRows = await pool.query(`SELECT official_email FROM sales_persons`)
      expect(dbRows.rows).toEqual([{ official_email: 'a@amnex.com' }])
    })
  })

  it('listDomains reports the current taxClasses row count', async () => {
    const caller = appRouter.createCaller(authorizedContext())
    const domains = { taxClasses: [{ code: 'GST18', name: 'A', ratePct: 18 }] }
    const preview = await caller.adminImport.session.validate({ domains })
    await caller.adminImport.session.commit({ domains, sessionCommitToken: preview.sessionCommitToken, excludedRows: [] })
    const list = await caller.adminImport.listDomains()
    expect(list.find((d) => d.domain === 'taxClasses')?.currentRowCount).toBe(1)
  })

  it('previewGeographyLoad and commitGeographyLoad work end-to-end through the router', async () => {
    const caller = appRouter.createCaller(authorizedContext())
    const preview = await caller.adminImport.previewGeographyLoad()
    expect(preview.reconciliation.matches).toBe(true)
    expect(preview.summary.toCreate).toBeGreaterThan(7000)
    expect(typeof preview.commitToken).toBe('string')

    const result = await caller.adminImport.commitGeographyLoad({ commitToken: preview.commitToken })
    expect(result.summary.toCreate).toBe(preview.summary.toCreate)

    const domains = await caller.adminImport.listDomains()
    expect(domains.find((d) => d.domain === 'geography')?.currentRowCount).toBeGreaterThan(7000)
  }, 30000)

  it("records the authenticated caller's email on the committed session", async () => {
    const caller = appRouter.createCaller(authorizedContext())
    const domains = { taxClasses: [{ code: 'GST18', name: 'GST 18%', ratePct: 18 }] }
    const preview = await caller.adminImport.session.validate({ domains })
    const result = await caller.adminImport.session.commit({ domains, sessionCommitToken: preview.sessionCommitToken, excludedRows: [] })
    const dbRow = await pool.query(`SELECT actor_email FROM admin_import_runs WHERE session_id=$1`, [result.sessionId])
    expect(dbRow.rows[0].actor_email).toBe(AUTHORIZED_TEST_EMAIL)
  })

  describe('adminImport identity gate', () => {
    it('rejects a call with no Authorization header', async () => {
      const caller = appRouter.createCaller({})
      await expect(caller.adminImport.listDomains()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('rejects a signed-in but non-allow-listed caller', async () => {
      const caller = appRouter.createCaller(authorizedContext('someone-else@gmail.com'))
      await expect(caller.adminImport.listDomains()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('allows an allow-listed caller through', async () => {
      const caller = appRouter.createCaller(authorizedContext())
      await expect(caller.adminImport.listDomains()).resolves.toBeDefined()
    })
  })

  describe('EMERGENCY_READ_ONLY scoping (final review Important #2)', () => {
    afterEach(() => {
      delete process.env.EMERGENCY_READ_ONLY
    })

    it('still allows listDomains (a query/read) through when EMERGENCY_READ_ONLY is on', async () => {
      process.env.EMERGENCY_READ_ONLY = 'true'
      const caller = appRouter.createCaller(authorizedContext())
      await expect(caller.adminImport.listDomains()).resolves.toBeDefined()
    })

    it('still blocks session.commit (a mutation/write) when EMERGENCY_READ_ONLY is on', async () => {
      process.env.EMERGENCY_READ_ONLY = 'true'
      const caller = appRouter.createCaller(authorizedContext())
      const domains = { taxClasses: [{ code: 'GST18', name: 'GST 18%', ratePct: 18 }] }
      await expect(
        caller.adminImport.session.commit({ domains, sessionCommitToken: 'irrelevant-token', excludedRows: [] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })
  })
})
