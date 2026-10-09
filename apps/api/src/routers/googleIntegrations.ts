import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { GOOGLE_SERVICES, DEFAULT_GOOGLE_INTEGRATIONS } from '@goms/domain'
import { protectedProcedure, protectedReadProcedure, router, type Context } from '../trpc.js'
import { isAmnexAccount, verifyFirebaseToken } from '../auth/identity.js'
import { pool } from '../db.js'

async function account(ctx: Context) {
  const user = await verifyFirebaseToken(ctx.authHeader)
  if (!isAmnexAccount(user.email)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with your @amnex.com Google account.' })
  return user
}
const settingsShape = z.object({
  clientId: z.string().max(300).regex(/^$|^[\w.-]+\.apps\.googleusercontent\.com$/),
  disabledPages: z.record(z.enum(GOOGLE_SERVICES), z.array(z.string().regex(/^[a-z][a-z0-9-]{0,79}$/)).max(200)),
  docsId: z.string().max(200).regex(/^[\w-]*$/), sheetsId: z.string().max(200).regex(/^[\w-]*$/),
  cloudProject: z.string().max(100).regex(/^$|^[a-z0-9][a-z0-9-]*$/), notebookLocation: z.enum(['global', 'us', 'eu']),
}).strict()
/** Identity is verified even when the application's staged authentication flags are off. */
export const googleIntegrationsRouter = router({
  get: protectedReadProcedure.input(z.object({ accountUid: z.string().min(1).max(200) }).strict()).query(async ({ input, ctx }) => {
    const user = await account(ctx)
    if (input.accountUid !== user.uid) throw new TRPCError({ code: 'FORBIDDEN', message: 'Your signed-in account changed. Please retry.' })
    const { rows } = await pool.query('SELECT settings FROM google_integration_settings WHERE user_uid=$1', [user.uid])
    return rows[0]?.settings ?? { ...DEFAULT_GOOGLE_INTEGRATIONS }
  }),
  save: protectedProcedure.input(z.object({ accountUid: z.string().min(1).max(200), settings: settingsShape }).strict()).mutation(async ({ input, ctx }) => {
    const user = await account(ctx)
    if (input.accountUid !== user.uid) throw new TRPCError({ code: 'FORBIDDEN', message: 'Your signed-in account changed. Please retry.' })
    await pool.query(`INSERT INTO google_integration_settings (user_uid,email,settings) VALUES ($1,$2,$3)
      ON CONFLICT (user_uid) DO UPDATE SET email=EXCLUDED.email,settings=EXCLUDED.settings,updated_at=now()`, [user.uid, user.email, input.settings])
    return input.settings
  }),
})
