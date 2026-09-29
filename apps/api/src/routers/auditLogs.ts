import { z } from 'zod'
import { protectedReadProcedure, router } from '../trpc.js'
import { listAuditLogs } from '../lib/auditLog.js'

export const auditLogsRouter = router({
  list: protectedReadProcedure
    .input(z.object({ entityType: z.string().optional(), entityId: z.string().optional() }).optional())
    .query(({ input }) => listAuditLogs(input)),
})
