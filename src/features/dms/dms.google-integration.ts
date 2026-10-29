import { DMS_MODULES } from './connections'
import type { GoogleIntegrationFeature } from '@/features/integrations/registry'
export default DMS_MODULES.map(module => ({ id: `dms-${module.id}`, page: { ...module }, services: ['drive'] })) satisfies GoogleIntegrationFeature[]
