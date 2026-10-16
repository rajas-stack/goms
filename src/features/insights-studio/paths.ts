/** Insights Studio routes (registered in src/app/router.tsx with their permission-tree nodes). */
export const STUDIO_PATHS = {
  insights: '/insights?tab=overview',
  visuals: '/insights/studio/visuals',
  newVisual: '/insights/studio/visuals/new',
  visual: (id: string) => `/insights/studio/visuals/${encodeURIComponent(id)}`,
  reports: '/insights/studio/reports',
  report: (id: string) => `/insights/studio/reports/${encodeURIComponent(id)}`,
  dataSources: '/insights/data-sources',
} as const

/** "New visual" pre-set to a data source (from the Data Sources page). */
export const newVisualFrom = (datasetId: string) => `${STUDIO_PATHS.newVisual}?source=${encodeURIComponent(datasetId)}`
