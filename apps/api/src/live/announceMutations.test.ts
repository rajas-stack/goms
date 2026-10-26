import { describe, expect, it, vi } from 'vitest'

const announceChange = vi.hoisted(() => vi.fn())
vi.mock('./changeFeed.js', () => ({ announceChange }))

import { publicProcedure, protectedProcedure, router } from '../trpc.js'

const testRouter = router({
  save: protectedProcedure.mutation(() => 'saved'),
  fail: publicProcedure.mutation(() => { throw new Error('nope') }),
  read: publicProcedure.query(() => 'data'),
})

describe('announce mutations (live updates)', () => {
  it('announces a successful mutation by its path only', async () => {
    announceChange.mockClear()
    await testRouter.createCaller({}).save()
    expect(announceChange).toHaveBeenCalledTimes(1)
    expect(announceChange).toHaveBeenCalledWith('save')
  })

  it('announces neither failed mutations nor queries', async () => {
    announceChange.mockClear()
    await expect(testRouter.createCaller({}).fail()).rejects.toThrow()
    await testRouter.createCaller({}).read()
    expect(announceChange).not.toHaveBeenCalled()
  })
})
