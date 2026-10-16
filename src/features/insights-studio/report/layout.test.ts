import { describe, expect, it } from 'vitest'
import type { ReportWidget } from '@goms/domain'
import { addWidget, defaultSize, duplicateWidget, moveWidget, patchWidget, placeWidget, removeWidget, resizeWidget } from './layout'

const w = (id: string, x: number, y: number, width = 6, height = 4): ReportWidget => ({ id, kind: 'visual', visualId: 'builtin:pipeline-value', x, y, w: width, h: height })
const grid = [w('a', 0, 0), w('b', 6, 0), w('c', 0, 4)]

describe('report layout', () => {
  it('moves within the 12 columns and never mutates the input', () => {
    const before = JSON.stringify(grid)
    expect(moveWidget(grid, 'a', -3, 0).find((x) => x.id === 'a')).toMatchObject({ x: 0, y: 0 })
    expect(moveWidget(grid, 'b', 5, 0).find((x) => x.id === 'b')).toMatchObject({ x: 6 })
    expect(JSON.stringify(grid)).toBe(before)
  })

  it('pushes overlapped widgets down instead of stacking them', () => {
    const next = placeWidget(grid, 'c', 0, 0)
    expect(next.find((x) => x.id === 'c')).toMatchObject({ x: 0, y: 0 })
    expect(next.find((x) => x.id === 'a')).toMatchObject({ y: 4 })
    expect(next.find((x) => x.id === 'b')).toMatchObject({ y: 0 })
  })

  it('resizes within the grid and bumps neighbours', () => {
    const wider = resizeWidget(grid, 'a', 3, 0)
    expect(wider.find((x) => x.id === 'a')).toMatchObject({ w: 9 })
    expect(wider.find((x) => x.id === 'b')!.y).toBeGreaterThanOrEqual(4)
    expect(resizeWidget(grid, 'b', 10, -10).find((x) => x.id === 'b')).toMatchObject({ w: 6, h: 1 })
  })

  it('adds at the bottom, duplicates, retitles and removes', () => {
    const added = addWidget(grid, { kind: 'text', text: 'Orders' }, defaultSize('text'))
    expect(added[added.length - 1]).toMatchObject({ id: 'w4', kind: 'text', x: 0, y: 8, w: 12, h: 1 })
    expect(duplicateWidget(grid, 'b')[3]).toMatchObject({ visualId: 'builtin:pipeline-value', y: 8 })
    expect(patchWidget(grid, 'a', { title: 'Pipeline' })[0].title).toBe('Pipeline')
    expect(removeWidget(grid, 'b').map((x) => x.id)).toEqual(['a', 'c'])
    expect(defaultSize('kpi')).toEqual({ w: 3, h: 2 })
  })
})
