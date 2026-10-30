import type { GoogleIntegrationFeature } from '@/features/integrations/registry'

export default [{ id: 'calendar-page', page: { id: 'calendar', label: 'Calendar', path: '/calendar' }, services: ['calendar'] }] satisfies GoogleIntegrationFeature[]
