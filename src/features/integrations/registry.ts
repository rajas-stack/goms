import { useSyncExternalStore } from 'react'
import { GOOGLE_SERVICES, type GoogleService } from '@goms/domain'

export interface GoogleIntegrationFeature { id: string; page: { id: string; label: string; path: string }; services: readonly GoogleService[] }
const features = new Map<string, GoogleIntegrationFeature>()
const listeners = new Set<() => void>()
let revision = 0
/** Declare services next to a feature; Settings discovers its sidecar automatically, including lazy routes. */
export function registerGoogleFeature(feature: GoogleIntegrationFeature) {
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(feature.page.id) || !feature.page.path.startsWith('/') || feature.services.some(service => !GOOGLE_SERVICES.includes(service))) throw new Error('Invalid Google integration feature registration.')
  if (JSON.stringify(features.get(feature.id)) === JSON.stringify(feature)) return
  features.set(feature.id, feature); revision++; listeners.forEach(listener => listener())
}
const declarations = import.meta.glob<{ default: readonly GoogleIntegrationFeature[] }>('../../**/*.google-integration.ts', { eager: true })
for (const module of Object.values(declarations)) for (const feature of module.default) registerGoogleFeature(feature)
export function availableGooglePages(service: GoogleService) {
  const pages = new Map<string, GoogleIntegrationFeature['page']>()
  for (const feature of features.values()) if (feature.services.includes(service)) pages.set(feature.page.id, feature.page)
  return [...pages.values()].sort((a, b) => a.label.localeCompare(b.label))
}
export function useGooglePages(service: GoogleService) {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => revision, () => revision)
  return availableGooglePages(service)
}
