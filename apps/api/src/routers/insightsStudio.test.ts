import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('../db.js', () => ({ pool: db }))
import { insightsStudioRouter } from './insightsStudio.js'

const ID = '00000000-0000-4000-8000-000000000001'
const spec = { chart: 'kpi', query: { datasetId: 'opportunities.master', dimensions: [], measures: [{ field: '*', agg: 'count' }], filters: [] } }
const visualRow = (owner: string, shared = false) => ({
  id: ID, name: 'Pipeline', description: '', spec, owner_email: owner, shared,
  created_at: new Date('2026-10-01T00:00:00Z'), updated_at: new Date('2026-10-02T00:00:00Z'),
})
const as = (email: string) => insightsStudioRouter.createCaller({ user: { email, isAmnexAccount: true, emailVerified: true } } as any)
let stored: ReturnType<typeof visualRow> | null = null

describe('insights studio router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ADMIN_ALLOWED_EMAILS
    stored = visualRow('owner@amnex.com')
    db.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('SELECT * FROM insight_visuals WHERE id')) return { rows: stored ? [stored] : [] }
      if (sql.startsWith('SELECT * FROM insight_visuals')) return { rows: stored ? [stored] : [] }
      if (sql.startsWith('INSERT INTO insight_visuals')) return { rows: [{ ...visualRow(params[3] as string, params[4] as boolean), name: params[0], spec: JSON.parse(params[2] as string) }] }
      if (sql.startsWith('UPDATE insight_visuals')) return { rows: [{ ...stored, name: params[0] }] }
      if (sql.startsWith('DELETE')) return { rowCount: 1, rows: [] }
      if (sql.startsWith('SELECT id FROM insight_visuals')) return { rows: [] }
      return { rows: [] }
    })
  })

  it('lists visible visuals in API shape, scoped to the caller', async () => {
    expect(await as('Owner@amnex.com').listVisuals()).toEqual([expect.objectContaining({ id: ID, name: 'Pipeline', ownerEmail: 'owner@amnex.com', shared: false, createdAt: '2026-10-01T00:00:00.000Z' })])
    expect(db.query.mock.calls[0][1]).toEqual(['owner@amnex.com'])
  })

  it('creates a visual owned by the caller after validating the spec against the catalog', async () => {
    const saved = await as('maker@amnex.com').createVisual({ name: ' Pipeline ', spec })
    expect(saved).toMatchObject({ name: 'Pipeline', ownerEmail: 'maker@amnex.com' })
    await expect(as('maker@amnex.com').createVisual({ name: 'Bad', spec: { ...spec, query: { ...spec.query, datasetId: 'opportunities.campaign', dimensions: [{ field: 'sheet' }] } } }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/not a field of Campaign/) })
  })

  it('lets only the owner change a personal visual', async () => {
    await expect(as('other@amnex.com').updateVisual({ id: ID, name: 'Mine now', spec })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(as('other@amnex.com').deleteVisual({ id: ID })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await as('owner@amnex.com').updateVisual({ id: ID, name: 'Renamed', spec })).toMatchObject({ name: 'Renamed' })
    await as('owner@amnex.com').deleteVisual({ id: ID })
    expect(db.query.mock.calls.some((c) => String(c[0]).startsWith('DELETE FROM insight_visuals'))).toBe(true)
  })

  it('lets a System Admin manage a shared visual', async () => {
    stored = visualRow('owner@amnex.com', true)
    process.env.ADMIN_ALLOWED_EMAILS = 'admin@amnex.com'
    expect(await as('admin@amnex.com').updateVisual({ id: ID, name: 'Team pipeline', spec, shared: true })).toMatchObject({ name: 'Team pipeline' })
  })

  it('refuses a report that places an unknown visual and accepts built-in ones', async () => {
    db.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('SELECT id FROM insight_visuals')) return { rows: [] }
      if (sql.startsWith('INSERT INTO insight_reports')) return { rows: [{ id: ID, name: params[0], description: '', layout: JSON.parse(params[2] as string), filters: JSON.parse(params[3] as string), owner_email: params[4], shared: false, created_at: new Date(), updated_at: new Date() }] }
      return { rows: [] }
    })
    const filters = { period: { kind: 'half', fy: 2027, half: 1 } }
    await expect(as('a@amnex.com').createReport({ name: 'H1', filters, widgets: [{ id: 'w1', kind: 'visual', visualId: ID, x: 0, y: 0, w: 6, h: 4 }] }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const saved = await as('a@amnex.com').createReport({ name: 'H1', filters, widgets: [{ id: 'w1', kind: 'visual', visualId: 'builtin:pipeline-value', x: 0, y: 0, w: 3, h: 2 }] })
    expect(saved.widgets).toHaveLength(1)
  })
})
