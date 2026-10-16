import { beforeEach, describe, expect, it } from 'vitest'
import type { VisualSpec } from '@goms/domain'
import { repository, resetLocalData } from '@/data/repository'

const spec: VisualSpec = { chart: 'kpi', query: { datasetId: 'opportunities.master', dimensions: [], measures: [{ field: '*', agg: 'count' }], filters: [] } }
const filters = { period: { kind: 'half' as const, fy: 2027, half: 1 as const } }

describe('Insights Studio (local mode)', () => {
  beforeEach(async () => { await resetLocalData() })

  it('creates, lists, updates and deletes visuals with validated specs', async () => {
    const created = await repository.createInsightVisual({ name: ' Pipeline ', spec })
    expect(created).toMatchObject({ name: 'Pipeline', ownerEmail: 'local@this-device', shared: false })
    await expect(repository.createInsightVisual({ name: 'Bad', spec: { ...spec, query: { ...spec.query, datasetId: 'opportunities.campaign', dimensions: [{ field: 'sheet' }] } } }))
      .rejects.toThrow(/not a field of Campaign/)
    const updated = await repository.updateInsightVisual(created.id, { name: 'Open pipeline', spec, shared: true })
    expect(updated).toMatchObject({ name: 'Open pipeline', shared: true })
    expect((await repository.listInsightVisuals()).map((v) => v.name)).toEqual(['Open pipeline'])
    await repository.deleteInsightVisual(created.id)
    expect(await repository.listInsightVisuals()).toEqual([])
    await expect(repository.deleteInsightVisual(created.id)).rejects.toThrow(/no longer exists/)
  })

  it('saves reports that place built-in and saved visuals, refusing unknown ones', async () => {
    const visual = await repository.createInsightVisual({ name: 'Mine', spec })
    const report = await repository.createInsightReport({ name: 'H1', filters, widgets: [
      { id: 'w1', kind: 'visual', visualId: visual.id, x: 0, y: 0, w: 6, h: 4 },
      { id: 'w2', kind: 'visual', visualId: 'builtin:pipeline-value', x: 6, y: 0, w: 3, h: 2 },
      { id: 'w3', kind: 'text', text: 'Orders', x: 0, y: 4, w: 12, h: 1 },
    ] })
    expect(report.widgets).toHaveLength(3)
    await expect(repository.createInsightReport({ name: 'Bad', filters, widgets: [{ id: 'w1', kind: 'visual', visualId: 'missing', x: 0, y: 0, w: 6, h: 4 }] }))
      .rejects.toThrow(/does not exist/)
    const moved = await repository.updateInsightReport(report.id, { name: 'H1 FY27', filters, widgets: report.widgets.slice(1) })
    expect(moved.widgets.map((w) => w.id)).toEqual(['w2', 'w3'])
    const listed = await repository.listInsightReports()
    listed[0].widgets.length = 0
    expect((await repository.listInsightReports())[0].widgets).toHaveLength(2)
  })
})
