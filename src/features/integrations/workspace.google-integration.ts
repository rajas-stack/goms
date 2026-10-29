import type { GoogleIntegrationFeature } from './registry'
import { GOOGLE_SERVICES } from '@goms/domain'
import { DMS_MODULES } from '@/features/dms/connections'
export default DMS_MODULES.map(page => ({ id: `embedded-google-${page.id}`, page: { ...page }, services: GOOGLE_SERVICES })) satisfies GoogleIntegrationFeature[]
