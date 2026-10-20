import { buildApp } from './app.js'
import { syncRbacNodes } from './lib/rbacTreeStore.js'
import { startEmailSynchronizer } from './email/sync.js'
import { startProfileImageSynchronizer } from './profileImages/service.js'

const app = await buildApp()
const stopEmailSync = startEmailSynchronizer()
app.addHook('onClose', async () => stopEmailSync())
const stopProfileSync = startProfileImageSynchronizer()
app.addHook('onClose', async () => stopProfileSync())
// Bring the UI permission tree in line with the code that just deployed (new nodes inherit; removed ones retire).
syncRbacNodes(null).catch(() => app.log.error({ event: 'rbac_tree_sync_failed' }, 'RBAC tree synchronization failed'))
app.listen({ port: Number(process.env.PORT) || 8080, host: '0.0.0.0' })
