import type { PolicyEntry } from './types.js'

/** Document maker files are personal: each procedure verifies the caller itself and only ever touches rows the caller
 *  owns (routers/makerDocuments.ts), so there is no module grant to check. */
const self: PolicyEntry = { requirements: [], kind: 'self' }

export const documentMakerPolicy: Record<string, PolicyEntry> = Object.fromEntries([
  'makerDocuments.list', 'makerDocuments.create', 'makerDocuments.upload', 'makerDocuments.replace', 'makerDocuments.rename',
  'makerDocuments.duplicate', 'makerDocuments.delete', 'makerDocuments.editorConfig', 'makerDocuments.downloadUrl',
].map((path) => [path, self]))
