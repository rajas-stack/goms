import { describe, expect, it } from 'vitest'
import { stepRing, stepSwing } from './HangingIdCard'

const run = (theta: number, mode: 'free' | 'hover' | 'zero', seconds: number) => {
  let t = theta, w = 0, peak = 0
  for (let i = 0; i < seconds * 60; i++) { [t, w] = stepSwing(t, w, 1 / 60, mode); if (i > seconds * 30) peak = Math.max(peak, Math.abs(t)) }
  return peak
}

describe('stepSwing', () => {
  it('keeps swinging when dropped, but slowly loses energy', () => {
    const peak = run(0.5, 'free', 6)
    expect(peak).toBeGreaterThan(0.25)
    expect(peak).toBeLessThan(0.5)
  })
  it('slows far more while hovered', () => {
    expect(run(0.5, 'hover', 6)).toBeLessThan(run(0.5, 'free', 6) / 3)
  })
  it('comes to rest after click-zero', () => {
    expect(run(0.5, 'zero', 2)).toBeLessThan(0.01)
  })
})

describe('stepRing', () => {
  it('lags behind a moving strap, then catches up', () => {
    let phi = 0, w = 0
    for (let i = 0; i < 6; i++) [phi, w] = stepRing(phi, w, 0.5, 1 / 60)
    expect(phi).toBeLessThan(0.5)
    for (let i = 0; i < 600; i++) [phi, w] = stepRing(phi, w, 0.5, 1 / 60)
    expect(Math.abs(phi - 0.5)).toBeLessThan(0.01)
  })
})

describe('swing limits', () => {
  it('bounces off the rail instead of swinging past it', () => {
    let t = 1.4, w = 8 // flung hard toward the rail
    let maxT = 0, bounced = false
    for (let i = 0; i < 30; i++) { [t, w] = stepSwing(t, w, 1 / 60, 'free'); maxT = Math.max(maxT, t); if (w < 0) bounced = true }
    expect(maxT).toBeLessThanOrEqual(85 * Math.PI / 180 + 1e-9)
    expect(bounced).toBe(true)
  })
})
