import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../../db.js'
import { runSessionValidate, runSessionCommit } from './orchestrator.js'
import { AUTHORIZED_TEST_EMAIL } from '../../testHelpers/adminImportTestAuth.js'

describe('session orchestrator', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM employee_merge_audit')
    await pool.query('DELETE FROM transfers')
    await pool.query('DELETE FROM timeline_events')
    await pool.query('DELETE FROM employee_charges')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM bid_milestones')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM employees')
    await pool.query(`DELETE FROM hierarchy_nodes WHERE domain='org'`)
    await pool.query('DELETE FROM admin_import_runs')
  })

  it('resolves an employee row against an org node created earlier in the SAME session', async () => {
    const result = await runSessionValidate(pool, {
      domains: {
        organizationHierarchy: [{ nodeType: 'department', name: 'New Dept', code: 'NEWDEPT', parentCode: null, stateCode: null, status: 'active' }],
        employees: [{ employeeCode: 'E100', name: 'Jane Doe', designation: 'Officer', email: '', phone: '', orgNodeCode: 'NEWDEPT', managerCode: null, vacant: false, status: 'active' }],
      },
    })
    expect(result.domainOrder).toEqual(['organizationHierarchy', 'employees'])
    const employeesPreview = result.previews.find((p) => p.domain === 'employees')!.preview as any[]
    expect(employeesPreview[0].action).toBe('create')

    // Nothing was actually written — validate never commits.
    const count = await pool.query(`SELECT COUNT(*) FROM hierarchy_nodes WHERE code='NEWDEPT'`)
    expect(Number(count.rows[0].count)).toBe(0)
  })

  it('commits every domain in one transaction and records one audit row per domain under one session id', async () => {
    const domains = {
      organizationHierarchy: [{ nodeType: 'department', name: 'New Dept', code: 'NEWDEPT2', parentCode: null, stateCode: null, status: 'active' }],
      employees: [{ employeeCode: 'E101', name: 'Jane Doe', designation: 'Officer', email: '', phone: '', orgNodeCode: 'NEWDEPT2', managerCode: null, vacant: false, status: 'active' }],
    }
    const validated = await runSessionValidate(pool, { domains })
    const result = await runSessionCommit(pool, { domains, sessionCommitToken: validated.sessionCommitToken, excludedRows: [] }, AUTHORIZED_TEST_EMAIL)

    expect(result.summary.toCreate).toBe(2)
    const org = await pool.query(`SELECT COUNT(*) FROM hierarchy_nodes WHERE code='NEWDEPT2'`)
    expect(Number(org.rows[0].count)).toBe(1)
    const emp = await pool.query(`SELECT COUNT(*) FROM employees WHERE code='E101'`)
    expect(Number(emp.rows[0].count)).toBe(1)

    const runs = await pool.query(`SELECT domain, session_id FROM admin_import_runs WHERE session_id=$1`, [result.sessionId])
    expect(runs.rows.map((r: any) => r.domain).sort()).toEqual(['employees', 'organizationHierarchy'])
    expect(runs.rows.every((r: any) => r.session_id === result.sessionId)).toBe(true)
  })

  it('refuses to commit while any row across the session is needs-review or reject', async () => {
    const domains = {
      employees: [{ employeeCode: 'E102', name: 'Jane Doe', designation: 'Officer', email: '', phone: '', orgNodeCode: 'GHOSTCODE', managerCode: null, vacant: false, status: 'active' }],
    }
    const validated = await runSessionValidate(pool, { domains })
    await expect(
      runSessionCommit(pool, { domains, sessionCommitToken: validated.sessionCommitToken, excludedRows: [] }, AUTHORIZED_TEST_EMAIL),
    ).rejects.toThrow(/unresolved or rejected/)
    const emp = await pool.query(`SELECT COUNT(*) FROM employees WHERE code='E102'`)
    expect(Number(emp.rows[0].count)).toBe(0)
  })

  it('rolls back an earlier domain\'s writes when a later domain in the same session fails to commit', async () => {
    const domains = {
      organizationHierarchy: [{ nodeType: 'department', name: 'Rollback Dept', code: 'RBDEPT', parentCode: null, stateCode: null, status: 'active' }],
      employees: [{ employeeCode: 'E103', name: 'Jane Doe', designation: 'Officer', email: '', phone: '', orgNodeCode: 'GHOSTCODE', managerCode: null, vacant: false, status: 'active' }],
    }
    const validated = await runSessionValidate(pool, { domains })
    await expect(
      runSessionCommit(pool, { domains, sessionCommitToken: validated.sessionCommitToken, excludedRows: [] }, AUTHORIZED_TEST_EMAIL),
    ).rejects.toThrow()
    const org = await pool.query(`SELECT COUNT(*) FROM hierarchy_nodes WHERE code='RBDEPT'`)
    expect(Number(org.rows[0].count)).toBe(0)
  })

  it('rejects a stale commit token when the submitted rows differ from what was validated', async () => {
    const domains = { taxClasses: [{ code: 'GST18', name: 'GST 18%', ratePct: 18 }] }
    const validated = await runSessionValidate(pool, { domains })
    const tamperedDomains = { taxClasses: [{ code: 'GST18', name: 'GST 18% (tampered)', ratePct: 18 }] }
    await expect(
      runSessionCommit(pool, { domains: tamperedDomains, sessionCommitToken: validated.sessionCommitToken, excludedRows: [] }, AUTHORIZED_TEST_EMAIL),
    ).rejects.toThrow(/changed since it was previewed/)
  })

  // Regression coverage for a commit-token/exclusion bug caught in plan
  // review: an earlier design required the caller to remove excluded rows
  // from `domains` before calling commit while reusing the token from the
  // (unexcluded) validate call — that hash mismatch made every session with
  // an exclusion look identical to real tampering and get wrongly rejected
  // as stale. These two tests prove the fix holds in both directions: an
  // exclusion, resubmitted with the SAME original domains and SAME original
  // token, must succeed; a genuine edit to a non-excluded row, even with an
  // exclusion also present, must still be rejected as stale.
  it('commits successfully when a needs-review row is excluded and resubmitted with the SAME domains and SAME token from the original validate call', async () => {
    await pool.query(
      `INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, code, sort_order, metadata, status)
       VALUES ('org','department',NULL,NULL,'Existing Dept','EXCLDEPT',0,'{}','active')`,
    )
    const domains = {
      employees: [
        { employeeCode: 'EXCLGOOD', name: 'Jane', designation: 'Officer', email: '', phone: '', orgNodeCode: 'EXCLDEPT', managerCode: null, vacant: false, status: 'active' },
        { employeeCode: 'EXCLBAD', name: 'John', designation: 'Officer', email: '', phone: '', orgNodeCode: 'EXCLDEPTX', managerCode: null, vacant: false, status: 'active' },
      ],
    }
    const validated = await runSessionValidate(pool, { domains })
    const employeesPreview = validated.previews.find((p) => p.domain === 'employees')!.preview as any[]
    expect(employeesPreview[1].action).toBe('needs-review')

    const excludedRows = [{ domain: 'employees' as const, rowNumber: 2, businessKey: 'EXCLBAD', reason: 'no confident match' }]
    // Same `domains` object, same `sessionCommitToken` — no client-side
    // trimming, no second validate call. This is the exact shape the bug
    // broke: reusing the original token while a caller had ALSO removed the
    // excluded row from `domains` itself would have failed here.
    const result = await runSessionCommit(pool, { domains, sessionCommitToken: validated.sessionCommitToken, excludedRows }, AUTHORIZED_TEST_EMAIL)
    expect(result.summary.toCreate).toBe(1)
  })

  it('still rejects as stale when a NON-excluded row is genuinely modified, even with a legitimate exclusion also present', async () => {
    await pool.query(
      `INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, code, sort_order, metadata, status)
       VALUES ('org','department',NULL,NULL,'Existing Dept','EXCLDEPT2',0,'{}','active')`,
    )
    const domains = {
      employees: [
        { employeeCode: 'EXCLGOOD2', name: 'Jane', designation: 'Officer', email: '', phone: '', orgNodeCode: 'EXCLDEPT2', managerCode: null, vacant: false, status: 'active' },
        { employeeCode: 'EXCLBAD2', name: 'John', designation: 'Officer', email: '', phone: '', orgNodeCode: 'EXCLDEPT2X', managerCode: null, vacant: false, status: 'active' },
      ],
    }
    const validated = await runSessionValidate(pool, { domains })
    const excludedRows = [{ domain: 'employees' as const, rowNumber: 2, businessKey: 'EXCLBAD2', reason: 'no confident match' }]

    // Row 1 (not excluded) is tampered with after the fact — the designation
    // changes from what was actually validated.
    const tamperedDomains = {
      employees: [
        { ...domains.employees[0], designation: 'Tampered Designation' },
        domains.employees[1],
      ],
    }
    await expect(
      runSessionCommit(pool, { domains: tamperedDomains, sessionCommitToken: validated.sessionCommitToken, excludedRows }, AUTHORIZED_TEST_EMAIL),
    ).rejects.toThrow(/changed since it was previewed/)
  })

  it('walks the full ambiguity flow: needs-review blocks commit, exclusion + resubmission (same domains, same token) succeeds and is audited, and a later edit to the accepted row is still caught as stale', async () => {
    await pool.query(
      `INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, code, sort_order, metadata, status)
       VALUES ('org','department',NULL,NULL,'Existing Dept','EXISTDEPT',0,'{}','active')`,
    )

    // One good row, one row with a near-miss Org Node Code (needs-review).
    const domains = {
      employees: [
        { employeeCode: 'GOOD1', name: 'Jane', designation: 'Officer', email: '', phone: '', orgNodeCode: 'EXISTDEPT', managerCode: null, vacant: false, status: 'active' },
        { employeeCode: 'AMBIG1', name: 'John', designation: 'Officer', email: '', phone: '', orgNodeCode: 'EXISTDEPTX', managerCode: null, vacant: false, status: 'active' },
      ],
    }
    const validated = await runSessionValidate(pool, { domains })
    const employeesPreview = validated.previews.find((p) => p.domain === 'employees')!.preview as any[]
    expect(employeesPreview[1].action).toBe('needs-review')
    expect(employeesPreview[1].candidates?.[0].key).toBe('EXISTDEPT')

    // Commit is blocked while the needs-review row is present and unexcluded.
    await expect(
      runSessionCommit(pool, { domains, sessionCommitToken: validated.sessionCommitToken, excludedRows: [] }, AUTHORIZED_TEST_EMAIL),
    ).rejects.toThrow(/unresolved or rejected/)

    const excludedRows = [{ domain: 'employees' as const, rowNumber: 2, businessKey: 'AMBIG1', reason: 'no confident match; will re-upload with corrected code' }]

    // A genuine edit to the ACCEPTED row (row 1, not excluded) must still be
    // caught as stale even though a legitimate exclusion is also present —
    // proves the exclusion mechanism can't be used to smuggle an unrelated
    // change past the staleness check.
    const tamperedDomains = { employees: [{ ...domains.employees[0], designation: 'Sneaked-in change' }, domains.employees[1]] }
    await expect(
      runSessionCommit(pool, { domains: tamperedDomains, sessionCommitToken: validated.sessionCommitToken, excludedRows }, AUTHORIZED_TEST_EMAIL),
    ).rejects.toThrow(/changed since it was previewed/)

    // The real flow: SAME domains, SAME token from the one validate call
    // above — no client-side trimming, no second validate. This is exactly
    // the shape a prior version of this design got wrong (see Task 7's design
    // note): reusing this token while ALSO removing AMBIG1 from `domains`
    // before sending it would have failed here with a false staleness error.
    const result = await runSessionCommit(pool, { domains, sessionCommitToken: validated.sessionCommitToken, excludedRows }, AUTHORIZED_TEST_EMAIL)

    // 1. Commit succeeded (reaching here at all).
    // 2. The excluded row was not written.
    const ambiguous = await pool.query(`SELECT COUNT(*) FROM employees WHERE code='AMBIG1'`)
    expect(Number(ambiguous.rows[0].count)).toBe(0)
    // 3. The accepted row was written.
    expect(result.summary.toCreate).toBe(1)
    const emp = await pool.query(`SELECT COUNT(*) FROM employees WHERE code='GOOD1'`)
    expect(Number(emp.rows[0].count)).toBe(1)
    // 4. The exclusion is recorded in the audit trail.
    const runs = await pool.query(`SELECT excluded_rows FROM admin_import_runs WHERE session_id=$1 AND domain='employees'`, [result.sessionId])
    expect(runs.rows[0].excluded_rows).toEqual(excludedRows)
  })

  it('re-committing an identical multi-domain session a second time classifies everything unchanged', async () => {
    const domains = {
      organizationHierarchy: [{ nodeType: 'department', name: 'Idempotent Dept', code: 'IDEMPDEPT', parentCode: null, stateCode: null, status: 'active' }],
      employees: [{ employeeCode: 'IDEMP1', name: 'Jane', designation: 'Officer', email: '', phone: '', orgNodeCode: 'IDEMPDEPT', managerCode: null, vacant: false, status: 'active' }],
    }
    const firstValidate = await runSessionValidate(pool, { domains })
    await runSessionCommit(pool, { domains, sessionCommitToken: firstValidate.sessionCommitToken, excludedRows: [] }, AUTHORIZED_TEST_EMAIL)

    const secondValidate = await runSessionValidate(pool, { domains })
    expect(secondValidate.summary).toMatchObject({ toCreate: 0, toUpdate: 0, needsReview: 0, rejected: 0 })
    expect(secondValidate.summary.unchanged).toBe(2)

    const orgCount = await pool.query(`SELECT COUNT(*) FROM hierarchy_nodes WHERE code='IDEMPDEPT'`)
    expect(Number(orgCount.rows[0].count)).toBe(1) // no duplicate row was created
  })
})
