import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../../db.js'
import { validateOrgHierarchyRows, commitOrgHierarchyRows } from './organizationHierarchy.js'
import { summarize } from '../engine.js'

describe('organizationHierarchy importer', () => {
  beforeEach(async () => {
    // This suite runs sequentially against one shared real Postgres
    // (vitest.config.ts's fileParallelism:false), so a leftover row from
    // another test file referencing an `org`-domain hierarchy_nodes row
    // (employees.org_node_id, opportunities/commercial_boqs.department_id —
    // all ON DELETE RESTRICT) blocks the delete below unless cleared first.
    // Same convention employees.test.ts's own beforeEach already establishes
    // for the identical reason.
    await pool.query('DELETE FROM employee_merge_audit')
    await pool.query('DELETE FROM transfers')
    await pool.query('DELETE FROM timeline_events')
    await pool.query('DELETE FROM employee_charges')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM employees')
    // Single statement covering the whole `domain='org'` subtree — Postgres
    // checks the self-referencing hierarchy_nodes.parent_id FK at
    // statement-end, not per-row, so deleting parents and children together
    // in one DELETE is safe (same reasoning hierarchy.ts's deleteNode relies
    // on for its own multi-row delete).
    await pool.query(`DELETE FROM hierarchy_nodes WHERE domain='org'`)
  })

  it('creates a root department with no Parent Code', async () => {
    const rows = [{ nodeType: 'department', name: 'Traffic Dept', code: 'TRAFDEPT', parentCode: null, stateCode: null, status: 'active' }]
    const preview = await validateOrgHierarchyRows(pool, rows)
    expect(preview[0].action).toBe('create')
  })

  it('resolves a child office against a department earlier in the same file', async () => {
    const rows = [
      { nodeType: 'department', name: 'Traffic Dept', code: 'TRAFDEPT', parentCode: null, stateCode: null, status: 'active' },
      { nodeType: 'office', name: 'Traffic Office', code: 'TRAFOFF', parentCode: 'TRAFDEPT', stateCode: null, status: 'active' },
    ]
    const preview = await validateOrgHierarchyRows(pool, rows)
    expect(preview[0].action).toBe('create')
    expect(preview[1].action).toBe('create')
  })

  it('commits a nested department using its parent department\'s Code as Parent Code', async () => {
    const rows = [
      { nodeType: 'department', name: 'Electronics & IT', code: 'ELECIT', parentCode: null, stateCode: null, status: 'active' },
      { nodeType: 'department', name: 'Industry Bodies', code: 'INDBOD', parentCode: 'ELECIT', stateCode: null, status: 'active' },
    ]
    const preview = await validateOrgHierarchyRows(pool, rows)
    expect(preview[0].action).toBe('create')
    expect(preview[1].action).toBe('create')
    await commitOrgHierarchyRows(pool, rows, preview)
    const result = await pool.query(
      `SELECT child.code AS child_code, parent.code AS parent_code
       FROM hierarchy_nodes child JOIN hierarchy_nodes parent ON parent.id = child.parent_id
       WHERE child.domain='org' AND child.code='INDBOD'`,
    )
    expect(result.rows[0]).toMatchObject({ child_code: 'INDBOD', parent_code: 'ELECIT' })
  })

  it('rejects a Node Type outside department/branch/division/office/unit', async () => {
    const rows = [{ nodeType: 'headquarters', name: 'HQ', code: 'HQ1', parentCode: null, stateCode: null, status: 'active' }]
    const preview = await validateOrgHierarchyRows(pool, rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors[0]).toMatch(/node type/i)
  })

  it('rejects a row whose Parent Code matches nothing in the file or the database', async () => {
    const rows = [{ nodeType: 'office', name: 'Ghost Office', code: 'GOFF', parentCode: 'GHOST', stateCode: null, status: 'active' }]
    const preview = await validateOrgHierarchyRows(pool, rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors[0]).toMatch(/GHOST/)
  })

  it("an existing node's Code match with an identical Parent Code/Name/State Code/Status is unchanged", async () => {
    const rows = [{ nodeType: 'department', name: 'Traffic Dept', code: 'TRAFDEPT', parentCode: null, stateCode: 21, status: 'active' }]
    const preview = await validateOrgHierarchyRows(pool, rows)
    await commitOrgHierarchyRows(pool, rows, preview)
    const secondPreview = await validateOrgHierarchyRows(pool, rows)
    expect(summarize(secondPreview)).toMatchObject({ toCreate: 0, toUpdate: 0, unchanged: 1 })
  })

  it("changing an existing node's Name is classified update with a name diff", async () => {
    const rows = [{ nodeType: 'department', name: 'Traffic Dept', code: 'TRAFDEPT', parentCode: null, stateCode: null, status: 'active' }]
    const preview = await validateOrgHierarchyRows(pool, rows)
    await commitOrgHierarchyRows(pool, rows, preview)
    const changed = [{ ...rows[0], name: 'Traffic Department' }]
    const secondPreview = await validateOrgHierarchyRows(pool, changed)
    expect(secondPreview[0].action).toBe('update')
    expect(secondPreview[0].diff).toEqual([{ field: 'name', oldValue: 'Traffic Dept', newValue: 'Traffic Department' }])
  })

  // --- Additional coverage beyond the plan's named list, exercising the
  // parts of the spec (order-independent resolution, commit's actual writes,
  // reject-rows-never-written) that the named list alone doesn't reach. ---

  it('resolves a child office against a department later in the same file (reverse order)', async () => {
    const rows = [
      { nodeType: 'office', name: 'Traffic Office', code: 'TRAFOFF', parentCode: 'TRAFDEPT', stateCode: null, status: 'active' },
      { nodeType: 'department', name: 'Traffic Dept', code: 'TRAFDEPT', parentCode: null, stateCode: null, status: 'active' },
    ]
    const preview = await validateOrgHierarchyRows(pool, rows)
    expect(preview[0].action).toBe('create')
    expect(preview[1].action).toBe('create')
  })

  it('commit resolves and persists the parent chain correctly even when the child row appears first', async () => {
    const rows = [
      { nodeType: 'office', name: 'Traffic Office', code: 'TRAFOFF', parentCode: 'TRAFDEPT', stateCode: null, status: 'active' },
      { nodeType: 'department', name: 'Traffic Dept', code: 'TRAFDEPT', parentCode: null, stateCode: null, status: 'active' },
    ]
    const preview = await validateOrgHierarchyRows(pool, rows)
    await commitOrgHierarchyRows(pool, rows, preview)
    const result = await pool.query(
      `SELECT child.code AS child_code, parent.code AS parent_code
       FROM hierarchy_nodes child JOIN hierarchy_nodes parent ON parent.id = child.parent_id
       WHERE child.domain='org' AND child.code='TRAFOFF'`,
    )
    expect(result.rows[0]).toMatchObject({ child_code: 'TRAFOFF', parent_code: 'TRAFDEPT' })
  })

  it('commits only create/update rows, never touching rejected ones', async () => {
    const rows = [
      { nodeType: 'department', name: 'Traffic Dept', code: 'TRAFDEPT', parentCode: null, stateCode: null, status: 'active' },
      { nodeType: 'not-a-real-type', name: 'Bad', code: 'BAD1', parentCode: null, stateCode: null, status: 'active' },
    ]
    const preview = await validateOrgHierarchyRows(pool, rows)
    await commitOrgHierarchyRows(pool, rows, preview)
    const result = await pool.query(`SELECT code FROM hierarchy_nodes WHERE domain='org'`)
    expect(result.rows.map((r) => r.code)).toEqual(['TRAFDEPT'])
  })

  it('a root row with a blank Parent Code creates a node with no parent', async () => {
    const rows = [{ nodeType: 'department', name: 'Traffic Dept', code: 'TRAFDEPT', parentCode: '', stateCode: null, status: 'active' }]
    const preview = await validateOrgHierarchyRows(pool, rows)
    await commitOrgHierarchyRows(pool, rows, preview)
    const result = await pool.query(`SELECT parent_id FROM hierarchy_nodes WHERE domain='org' AND code='TRAFDEPT'`)
    expect(result.rows[0].parent_id).toBeNull()
  })

  it('rejects the second occurrence of a duplicate Code within the same file', async () => {
    const rows = [
      { nodeType: 'department', name: 'Traffic Dept', code: 'TRAFDEPT', parentCode: null, stateCode: null, status: 'active' },
      { nodeType: 'department', name: 'Traffic Dept Again', code: 'trafdept', parentCode: null, stateCode: null, status: 'active' },
    ]
    const preview = await validateOrgHierarchyRows(pool, rows)
    expect(preview[0].action).toBe('create')
    expect(preview[1].action).toBe('reject')
    expect(preview[1].errors[0]).toMatch(/duplicate of row 1/i)
  })

  it('rejects a concurrent duplicate org code at the DB level even if two inserts race past the app-level check', async () => {
    await pool.query(
      `INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, code, sort_order, metadata, status)
       VALUES ('org','department',NULL,NULL,'Original','DUPCODE',0,'{}','active')`,
    )
    await expect(
      pool.query(
        `INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, code, sort_order, metadata, status)
         VALUES ('org','department',NULL,NULL,'Racing Insert','  dupcode  ',0,'{}','active')`,
      ),
    ).rejects.toThrow(/duplicate key value violates unique constraint/)
  })

  it('suggests a fuzzy candidate for a near-miss Parent Code', async () => {
    await pool.query(
      `INSERT INTO hierarchy_nodes (domain, type_key, parent_id, state_code, name, code, sort_order, metadata, status)
       VALUES ('org','division',NULL,NULL,'Trans Division','TRAFDIV',0,'{}','active')`,
    )
    const rows = [{ nodeType: 'department', name: 'Traffic Dept', code: 'NEWDEPT9', parentCode: 'TRAFDIB', stateCode: null, status: 'active' }]
    const preview = await validateOrgHierarchyRows(pool, rows)
    expect(preview[0].action).toBe('needs-review')
    expect(preview[0].candidates?.[0].key).toBe('TRAFDIV')
  })
})
