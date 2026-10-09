import type { GoogleIntegrationFeature } from '@/features/integrations/registry'
export default [{ id: 'pre-bid-maps', page: { id: 'opportunity', label: 'Opportunity / Bid tracker', path: '/bid-tracker' }, services: ['maps'] }] satisfies GoogleIntegrationFeature[]
