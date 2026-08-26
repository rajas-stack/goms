import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../../db.js'
import { validateEmployeeRows, commitEmployeeRows } from './employees.js'
import { summarize } from '../engine.js'

describe('employees importer', () => {
  let orgNodeCode: string

  beforeEach(async () => {
    // This suite runs sequentially against one shared real Postgres
    // (vitest.config.ts's fileParallelism:false), so a leftover row from
    // another test file referencing employees/hierarchy_nodes (all
    // ON DELETE RESTRICT) blocks the deletes below unless cleared first.
    // Same convention apps/api/src/routers/employees.test.ts's own
    // beforeEach already establishes for the identical reason.
    await pool.query('DELETE FROM employee_merge_audit')
    await pool.query('DELETE FROM transfers')
    await pool.query('DELETE FROM timeline_events')
    await pool.query('DELETE FROM employee_charges')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM employees')
    await pool.query(`DELETE FROM hierarchy_nodes WHERE domain='org'`)

    // Org Node Code fixture. hierarchy.createNode (the router procedure used
    // by apps/api/src/routers/employees.test.ts's beforeEach) never sets a
    // `code` column — it's a plain INSERT with no `code` in its column list
    // (apps/api/src/routers/hierarchy.ts:212-216) — so it cannot produce a
    // node this importer's Org Node Code column can reference by code.
    // Inserted directly instead, using the exact same column set
    // organizationHierarchy.ts's own commitOrgHierarchyRows writes with.
    orgNodeCode = 'ORGA'
    await pool.query(
      `INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, code, sort_order, metadata, status)
       VALUES ('org','department',NULL,NULL,'Org A',$1,0,'{}','active')`,
      [orgNodeCode],
    )
  })

  it('rejects an employee whose Org Node Code does not exist', async () => {
    const rows = [{ employeeCode: 'E001', name: 'Jane Doe', designation: 'Officer', email: '', phone: '', orgNodeCode: 'GHOST', managerCode: null, vacant: false, status: 'active' }]
    const preview = await validateEmployeeRows(pool, rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors[0]).toMatch(/no such organization hierarchy code: GHOST/i)
  })

  it('creates an employee referencing an existing Org Node Code', async () => {
    const rows = [{ employeeCode: 'E001', name: 'Jane Doe', designation: 'Officer', email: '', phone: '', orgNodeCode, managerCode: null, vacant: false, status: 'active' }]
    const preview = await validateEmployeeRows(pool, rows)
    expect(preview[0].action).toBe('create')
  })

  it('resolves Manager Employee Code against another row in the same file', async () => {
    const rows = [
      // Deliberately listed before its manager, to prove this is a real
      // forward-reference resolution and not just "manager happened to
      // come first" — mirrors organizationHierarchy.test.ts's equivalent
      // reverse-order coverage for Parent Code.
      { employeeCode: 'E002', name: 'Report', designation: 'Officer', email: '', phone: '', orgNodeCode, managerCode: 'E001', vacant: false, status: 'active' },
      { employeeCode: 'E001', name: 'Manager', designation: 'Head', email: '', phone: '', orgNodeCode, managerCode: null, vacant: false, status: 'active' },
    ]
    const preview = await validateEmployeeRows(pool, rows)
    expect(preview[0].action).toBe('create')
    expect(preview[1].action).toBe('create')
  })

  it('rejects a Manager Employee Code that resolves nowhere', async () => {
    const rows = [{ employeeCode: 'E001', name: 'Jane Doe', designation: 'Officer', email: '', phone: '', orgNodeCode, managerCode: 'GHOST', vacant: false, status: 'active' }]
    const preview = await validateEmployeeRows(pool, rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors[0]).toMatch(/GHOST/)
  })

  it('a re-imported identical row is classified unchanged', async () => {
    const rows = [{ employeeCode: 'E001', name: 'Jane Doe', designation: 'Officer', email: '', phone: '', orgNodeCode, managerCode: null, vacant: false, status: 'active' }]
    const preview = await validateEmployeeRows(pool, rows)
    await commitEmployeeRows(pool, rows, preview)
    const secondPreview = await validateEmployeeRows(pool, rows)
    expect(summarize(secondPreview)).toMatchObject({ toCreate: 0, toUpdate: 0, unchanged: 1 })
  })

  it('changing Designation on an existing Employee Code is classified update with a diff', async () => {
    const rows = [{ employeeCode: 'E001', name: 'Jane Doe', designation: 'Officer', email: '', phone: '', orgNodeCode, managerCode: null, vacant: false, status: 'active' }]
    const preview = await validateEmployeeRows(pool, rows)
    await commitEmployeeRows(pool, rows, preview)
    const changed = [{ ...rows[0], designation: 'Senior Officer' }]
    const secondPreview = await validateEmployeeRows(pool, changed)
    expect(secondPreview[0].action).toBe('update')
    expect(secondPreview[0].diff).toEqual([{ field: 'designation', oldValue: 'Officer', newValue: 'Senior Officer' }])
  })

  // --- Additional coverage beyond the plan's named list, exercising the
  // parts of the spec (commit's actual writes, reject-rows-never-written)
  // the named list alone doesn't reach — same pattern
  // organizationHierarchy.test.ts uses for its own extra coverage. ---

  it('commit resolves and persists the manager chain correctly even when the report row appears first', async () => {
    const rows = [
      { employeeCode: 'E002', name: 'Report', designation: 'Officer', email: '', phone: '', orgNodeCode, managerCode: 'E001', vacant: false, status: 'active' },
      { employeeCode: 'E001', name: 'Manager', designation: 'Head', email: '', phone: '', orgNodeCode, managerCode: null, vacant: false, status: 'active' },
    ]
    const preview = await validateEmployeeRows(pool, rows)
    await commitEmployeeRows(pool, rows, preview)
    const result = await pool.query(
      `SELECT child.code AS child_code, mgr.code AS manager_code
       FROM employees child JOIN employees mgr ON mgr.id = child.manager_id
       WHERE child.code='E002'`,
    )
    expect(result.rows[0]).toMatchObject({ child_code: 'E002', manager_code: 'E001' })
  })

  it('commits only create/update rows, never touching rejected ones', async () => {
    const rows = [
      { employeeCode: 'E001', name: 'Jane Doe', designation: 'Officer', email: '', phone: '', orgNodeCode, managerCode: null, vacant: false, status: 'active' },
      { employeeCode: 'E002', name: 'Bad', designation: 'Officer', email: '', phone: '', orgNodeCode: 'GHOST', managerCode: null, vacant: false, status: 'active' },
    ]
    const preview = await validateEmployeeRows(pool, rows)
    await commitEmployeeRows(pool, rows, preview)
    const result = await pool.query(`SELECT code FROM employees`)
    expect(result.rows.map((r) => r.code)).toEqual(['E001'])
  })

  it('rejects the second occurrence of a duplicate Employee Code within the same file', async () => {
    const rows = [
      { employeeCode: 'E001', name: 'Jane Doe', designation: 'Officer', email: '', phone: '', orgNodeCode, managerCode: null, vacant: false, status: 'active' },
      { employeeCode: 'e001', name: 'Jane Again', designation: 'Officer', email: '', phone: '', orgNodeCode, managerCode: null, vacant: false, status: 'active' },
    ]
    const preview = await validateEmployeeRows(pool, rows)
    expect(preview[0].action).toBe('create')
    expect(preview[1].action).toBe('reject')
    expect(preview[1].errors[0]).toMatch(/duplicate of row 1/i)
  })
})
