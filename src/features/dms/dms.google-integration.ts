import { DMS_MODULES } from './connections'
import type { GoogleIntegrationFeature } from '@/features/integrations/registry'
const paths: Record<string, string> = { accounts: '/map', meetings: '/meetings', sales: '/sales', teams: '/teams', commercial: '/commercial-calculator', opportunity: '/live-bids' }
export default DMS_MODULES.map(module => ({ id: `dms-${module.id}`, page: { ...module, path: paths[module.id] }, services: ['drive'] })) satisfies GoogleIntegrationFeature[]
