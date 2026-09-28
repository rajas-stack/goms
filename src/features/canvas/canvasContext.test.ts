import { describe, expect, it } from 'vitest'
import { elbowPath } from './canvasContext'

describe('elbowPath', () => {
  it('draws a vertical-then-horizontal-then-vertical elbow between two points', () => {
    const d = elbowPath({ key: 'a->b', x1: 100, y1: 50, x2: 220, y2: 150 })
    expect(d).toBe('M 100 50 V 100 H 220 V 150')
  })
})
