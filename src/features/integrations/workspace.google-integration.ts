import type { GoogleIntegrationFeature } from './registry'
import { GOOGLE_SERVICES } from '@goms/domain'
import { DMS_MODULES } from '@/features/dms/connections'
const paths: Record<string, string> = { accounts: '/map', meetings: '/meetings', sales: '/sales', teams: '/teams', commercial: '/commercial-calculator', opportunity: '/bid-tracker' }
export default DMS_MODULES.map(page => ({ id: `embedded-google-${page.id}`, page: { ...page, path: paths[page.id] }, services: GOOGLE_SERVICES })) satisfies GoogleIntegrationFeature[]
