import { publicProcedure, router } from '../trpc.js'
import { pool } from '../db.js'

export const healthRouter = router({
  check: publicProcedure.query(async () => {
    await pool.query('SELECT 1')
    return { ok: true, db: 'connected' } as const
  }),
})
