import type { GoogleIntegrationFeature } from './registry'
import { GOOGLE_SERVICES } from '@goms/domain'
export default [{ id: 'google-service-workspace', page: { id: 'integrations', label: 'Integrations', path: '/settings/integrations' }, services: GOOGLE_SERVICES }] satisfies GoogleIntegrationFeature[]
