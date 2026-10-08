import { describe, expect, it } from 'vitest'
import { BID_PHASE_RULES, generatePlannedPlan, type PhaseRule } from './rules'
import { addDays, diffDays } from './timelineDates'

function expectContiguous(plan: ReturnType<typeof generatePlannedPlan>, start: string, end: string) {
  expect(plan[0].plannedStart).toBe(start)
  expect(plan[plan.length - 1].plannedEnd).toBe(end)
  plan.slice(1).forEach((p, i) => expect(p.plannedStart).toBe(plan[i].plannedEnd))
  plan.forEach((p) => expect(diffDays(p.plannedStart, p.plannedEnd)).toBeGreaterThanOrEqual(0))
}

describe('generatePlannedPlan', () => {
  it.each([30, 60, 180])('builds a contiguous %i-day plan that ends on the end date', (days) => {
    const start = '2026-01-16'
    const end = addDays(start, days)
    const plan = generatePlannedPlan(start, end, BID_PHASE_RULES)
    expect(plan.map((p) => p.key)).toEqual(BID_PHASE_RULES.map((r) => r.key))
    expectContiguous(plan, start, end)
    expect(plan.reduce((s, p) => s + diffDays(p.plannedStart, p.plannedEnd), 0)).toBe(days)
  })

  it('sizes phases proportionally to their weights', () => {
    const rules: PhaseRule[] = [{ key: 'a', name: 'A', weight: 25 }, { key: 'b', name: 'B', weight: 75 }]
    const short = generatePlannedPlan('2026-01-01', '2026-01-21', rules)
    const long = generatePlannedPlan('2026-01-01', addDays('2026-01-01', 200), rules)
    expect(diffDays(short[0].plannedStart, short[0].plannedEnd)).toBe(5)
    expect(diffDays(short[1].plannedStart, short[1].plannedEnd)).toBe(15)
    expect(diffDays(long[0].plannedStart, long[0].plannedEnd)).toBe(50)
    expect(diffDays(long[1].plannedStart, long[1].plannedEnd)).toBe(150)
  })

  it('compresses the same rules for a 30-day and a 180-day opportunity', () => {
    const p30 = generatePlannedPlan('2026-03-01', addDays('2026-03-01', 30), BID_PHASE_RULES)
    const p180 = generatePlannedPlan('2026-03-01', addDays('2026-03-01', 180), BID_PHASE_RULES)
    const share = (p: typeof p30, total: number) => p.map((x) => diffDays(x.plannedStart, x.plannedEnd) / total)
    share(p30, 30).forEach((s, i) => expect(Math.abs(s - share(p180, 180)[i])).toBeLessThan(0.05))
  })

  it('handles 20+ phases and numbers them in order', () => {
    const rules = Array.from({ length: 24 }, (_, i) => ({ key: `p${i}`, name: `Phase ${i}`, weight: 1 + (i % 3) }))
    const plan = generatePlannedPlan('2025-01-01', '2026-12-31', rules)
    expect(plan).toHaveLength(24)
    expect(plan.map((p) => p.sequence)).toEqual(rules.map((_, i) => i + 1))
    expectContiguous(plan, '2025-01-01', '2026-12-31')
  })

  it('rejects an end before the start, bad dates and non-positive weights', () => {
    expect(() => generatePlannedPlan('2026-02-01', '2026-01-01', BID_PHASE_RULES)).toThrow()
    expect(() => generatePlannedPlan('nope', '2026-01-01', BID_PHASE_RULES)).toThrow()
    expect(() => generatePlannedPlan('2026-01-01', '2026-02-01', [{ key: 'x', name: 'X', weight: 0 }])).toThrow()
    expect(generatePlannedPlan('2026-01-01', '2026-02-01', [])).toEqual([])
  })
})
