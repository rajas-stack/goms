import { describe, it, expect } from 'vitest'
import { appRouter } from '../index.js'

describe('health router', () => {
  it('reports db connectivity', async () => {
    const caller = appRouter.createCaller({})
    const result = await caller.health.check()
    expect(result).toEqual({ ok: true, db: 'connected' })
  })

  it('remains reachable with no auth even when READ_AUTH_ENFORCEMENT_ENABLED is on', async () => {
    // health.check is deliberately excluded from the read-protection rollout
    // (2026-09-15 public-read security audit) — a standard uptime-probe
    // endpoint with no business data, kept public on purpose.
    process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
    try {
      const caller = appRouter.createCaller({})
      await expect(caller.health.check()).resolves.toEqual({ ok: true, db: 'connected' })
    } finally {
      delete process.env.READ_AUTH_ENFORCEMENT_ENABLED
    }
  })
})
