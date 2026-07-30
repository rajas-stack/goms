import { describe, expect, it } from 'vitest'
import { DEFAULT_STAGE_KEY, PIPELINE_STAGES, PIPELINE_STAGE_MAP, stageLabel } from './pipeline-stages'

describe('PIPELINE_STAGES', () => {
  it('has a unique key per stage', () => {
    const keys = PIPELINE_STAGES.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('has a unique order per stage', () => {
    const orders = PIPELINE_STAGES.map((s) => s.order)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('keeps every probability between 0 and 1', () => {
    for (const s of PIPELINE_STAGES) {
      expect(s.probability).toBeGreaterThanOrEqual(0)
      expect(s.probability).toBeLessThanOrEqual(1)
    }
  })

  it('marks won stages as closed', () => {
    for (const s of PIPELINE_STAGES) {
      if (s.isWon) expect(s.isClosed).toBe(true)
    }
  })

  it('gives closed-won probability 1 and closed-lost probability 0', () => {
    for (const s of PIPELINE_STAGES) {
      if (s.isClosed) expect(s.probability).toBe(s.isWon ? 1 : 0)
    }
  })

  it('exposes the default stage, and it is open', () => {
    expect(PIPELINE_STAGE_MAP[DEFAULT_STAGE_KEY]).toBeDefined()
    expect(PIPELINE_STAGE_MAP[DEFAULT_STAGE_KEY].isClosed).toBe(false)
  })
})

describe('stageLabel', () => {
  it('returns the label for a known stage', () => {
    expect(stageLabel('won')).toBe('Won')
  })

  it('falls back to the raw key for an unknown or retired stage', () => {
    expect(stageLabel('some_retired_stage')).toBe('some_retired_stage')
  })
})
