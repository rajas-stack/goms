import { describe, it, expect } from 'vitest'
import { appRouter } from '../index.js'

describe('health router', () => {
  it('reports db connectivity', async () => {
    const caller = appRouter.createCaller({})
    const result = await caller.health.check()
    expect(result).toEqual({ ok: true, db: 'connected' })
  })
})
