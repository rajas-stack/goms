import { z } from 'zod'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { emailConfiguration } from '../email/config.js'
import { beginMailConnection } from '../email/oauth.js'
import { emailActor } from '../email/access.js'
import { isSystemAdminEmail } from '../auth/rbac/systemAdminOnly.js'

/**
 * The Gmail connection only: `status` (is the server configured, who am I) and `connect` (start the Google authorization). The rest of the
 * Email Center (mailboxes, threads, send, record links, access grants) lives on the main lineage and is intentionally not part of this
 * release line. `capabilities` stays in the response so the shape matches main's; it is empty because no mail action exists here.
 */
export const emailCenterRouter = router({
  status: protectedReadProcedure.query(async ({ ctx }) => {
    const actor = await emailActor(ctx); const cfg = emailConfiguration()
    return { ready: cfg.ready, callback: cfg.ready ? cfg.redirectUri : null, email: actor.email, administrator: isSystemAdminEmail(actor.email), capabilities: [] as string[] }
  }),
  connect: protectedProcedure.input(z.object({ returnTo: z.string().max(512) }).strict()).mutation(async ({ input, ctx }) => beginMailConnection(await emailActor(ctx), input.returnTo, ctx.setCookie, ctx.requestCookies)),
})
