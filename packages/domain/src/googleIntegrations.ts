export const GOOGLE_SERVICES = ['gmail', 'drive', 'docs', 'sheets', 'calendar', 'chat', 'meet', 'maps', 'translate', 'sites', 'keep', 'notebooklm', 'tasks'] as const
export type GoogleService = typeof GOOGLE_SERVICES[number]
export interface GoogleIntegrationSettings {
  clientId: string
  disabledPages: Partial<Record<GoogleService, string[]>>
  docsId: string
  sheetsId: string
  cloudProject: string
  notebookLocation: 'global' | 'us' | 'eu'
}
export const DEFAULT_GOOGLE_INTEGRATIONS: GoogleIntegrationSettings = {
  clientId: '', disabledPages: {}, docsId: '', sheetsId: '', cloudProject: '', notebookLocation: 'global',
}
