import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../../db.js'
import { previewGeographyLoad, commitGeographyLoad, buildGeographyRows } from './geography.js'

describe('geography loader', () => {
  beforeEach(async () => {
    // domain='geo' nodes are never referenced by employees/opportunities/
    // commercial_boqs (those reference domain='org' nodes only), so a plain
    // scoped delete is sufficient here — no cross-domain FK to clear first.
    await pool.query(`DELETE FROM hierarchy_nodes WHERE domain='geo'`)
  })

  it('classifies every bundled row as create on an empty database', async () => {
    const preview = await previewGeographyLoad(pool)
    expect(preview.summary.toCreate).toBeGreaterThan(7000)
    expect(preview.summary.rejected).toBe(0)
  }, 30000)

  it('reconciliation matches: source row count equals create+update+unchanged', async () => {
    const preview = await previewGeographyLoad(pool)
    expect(preview.reconciliation.matches).toBe(true)
    expect(preview.reconciliation.sourceRowCount).toBe(preview.reconciliation.classifiedRowCount)
  }, 30000)

  it('commit writes every state/district/taluka node', async () => {
    const preview = await previewGeographyLoad(pool)
    await commitGeographyLoad(pool, preview.commitToken)
    const result = await pool.query(`SELECT COUNT(*) FROM hierarchy_nodes WHERE domain='geo'`)
    expect(Number(result.rows[0].count)).toBeGreaterThan(7000)
  }, 30000)

  it('a second load after commit is 100% unchanged and writes nothing new', async () => {
    const first = await previewGeographyLoad(pool)
    await commitGeographyLoad(pool, first.commitToken)
    const countAfterFirst = Number((await pool.query(`SELECT COUNT(*) FROM hierarchy_nodes WHERE domain='geo'`)).rows[0].count)

    const second = await previewGeographyLoad(pool)
    expect(second.summary).toMatchObject({ toCreate: 0, toUpdate: 0, rejected: 0 })
    expect(second.summary.unchanged).toBe(second.reconciliation.sourceRowCount)

    await commitGeographyLoad(pool, second.commitToken)
    const countAfterSecond = Number((await pool.query(`SELECT COUNT(*) FROM hierarchy_nodes WHERE domain='geo'`)).rows[0].count)
    expect(countAfterSecond).toBe(countAfterFirst)
  }, 60000)

  it('commit rejects a stale commitToken', async () => {
    await expect(commitGeographyLoad(pool, 'stale-token')).rejects.toThrow()
  }, 30000)

  it('detects a manual DB change since preview by rejecting the stale token on commit', async () => {
    const first = await previewGeographyLoad(pool)
    await commitGeographyLoad(pool, first.commitToken)

    // Simulate an out-of-band edit between preview and commit.
    await pool.query(`UPDATE hierarchy_nodes SET name='Manually Renamed' WHERE domain='geo' AND type_key='country'`)

    const second = await previewGeographyLoad(pool)
    // The India country row is now classified 'update' (name differs), so
    // this preview's token differs from a preview taken before the manual
    // edit — using the *first* preview's (now-stale) token must fail.
    await expect(commitGeographyLoad(pool, first.commitToken)).rejects.toThrow()
    // The fresh token from the second preview still works correctly.
    await commitGeographyLoad(pool, second.commitToken)
    const result = await pool.query(`SELECT name FROM hierarchy_nodes WHERE domain='geo' AND type_key='country'`)
    expect(result.rows[0].name).toBe('India')
  }, 60000)

  it('includes the synthetic Central Ministries virtual state row (stateCode 0)', () => {
    // Regression test for the 2026-08-31 production bug: this row was
    // missing from every import path (organizationHierarchy's NODE_TYPES
    // has no 'state' value, and this domain used to explicitly exclude it),
    // so `hierarchy.getState({code: 0})` returned null in production and
    // StateWorkspace rendered "No state found for code 0" instead of the
    // Central Ministries organization tree -- even though its child org
    // nodes (MoSPI, MeitY, ...) existed and were reachable by id all along.
    const rows = buildGeographyRows()
    const centralRow = rows.find((r) => r.level === 'state' && r.stateCode === 0)
    expect(centralRow).toMatchObject({
      level: 'state', name: 'Central Ministries (Govt. of India)', lgdCode: '0', parentLgdCode: null, stateCode: 0,
    })
    // Exactly one -- not accidentally duplicated across code changes.
    expect(rows.filter((r) => r.level === 'state' && r.stateCode === 0)).toHaveLength(1)
  })

  it('commits the Central Ministries virtual state as a real, queryable state node parented under India', async () => {
    const preview = await previewGeographyLoad(pool)
    await commitGeographyLoad(pool, preview.commitToken)

    const result = await pool.query(
      `SELECT central.name AS central_name, central.code AS central_code, country.name AS country_name
       FROM hierarchy_nodes central
       JOIN hierarchy_nodes country ON country.id = central.parent_id
       WHERE central.domain='geo' AND central.type_key='state' AND central.state_code=0`,
    )
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      central_name: 'Central Ministries (Govt. of India)', central_code: '0', country_name: 'India',
    })
  }, 30000)

  it('correctly links a real taluka to its own district and state, not a same-numbered district in another state', async () => {
    // Haryana (st_code '06', normalized to 6) has a district whose raw LGD
    // dt_code carries a leading zero ('069' -> 69, Panchkula) — the exact
    // case that silently dropped 781 talukas before this loader normalized
    // dt_code the same way seed.ts does. Spot-checks the full parent chain
    // for one of Panchkula's real talukas (Kalka, LGD subdistrict code 69
    // in the bundled data) resolves correctly end-to-end.
    const preview = await previewGeographyLoad(pool)
    await commitGeographyLoad(pool, preview.commitToken)

    const result = await pool.query(
      `SELECT taluka.name AS taluka_name, district.name AS district_name, district.code AS district_code,
              state.name AS state_name, state.code AS state_code
       FROM hierarchy_nodes taluka
       JOIN hierarchy_nodes district ON district.id = taluka.parent_id
       JOIN hierarchy_nodes state ON state.id = district.parent_id
       WHERE taluka.domain='geo' AND taluka.type_key='taluka' AND taluka.name='Kalka' AND taluka.state_code=6`,
    )
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ district_name: 'Panchkula', district_code: '69', state_name: 'Haryana', state_code: '6' })
  }, 30000)
})
