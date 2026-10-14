import { buildApp } from './app.js'
import { syncRbacNodes } from './lib/rbacTreeStore.js'

const app = await buildApp()
// Bring the UI permission tree in line with the code that just deployed (new nodes inherit; removed ones retire).
syncRbacNodes(null).catch((error) => app.log.error({ err: error }, 'rbac_tree_sync_failed'))
app.listen({ port: Number(process.env.PORT) || 8080, host: '0.0.0.0' })
