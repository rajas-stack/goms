import type { GoogleIntegrationFeature } from '@/features/integrations/registry'
export default [{ id: 'pre-bid-maps', page: { id: 'opportunity', label: 'Opportunity / Live Bids', path: '/live-bids' }, services: ['maps'] }] satisfies GoogleIntegrationFeature[]
