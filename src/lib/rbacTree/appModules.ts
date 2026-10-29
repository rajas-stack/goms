import { definePermissionNodes } from './registry'

/** The top-level modules of the app (the left rail / mobile drawer entries, Home, Settings). Their ids are the roots of the
 *  permission tree. */
export const APP_MODULES = definePermissionNodes(null, [
  { value: 'home', label: 'Home' },
  { value: 'accountMapping', label: 'Account Mapping' },
  { value: 'commercial', label: 'Commercial Calculator' },
  { value: 'opportunity', label: 'Opportunity' },
  { value: 'documentMaker', label: 'Document maker' },
  { value: 'documents', label: 'Documents' },
  { value: 'teams', label: 'Directory' },
  { value: 'settings', label: 'Settings' },
  { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'finance', label: 'Finance' },
] as const, { kind: 'module' })

export type AppModuleId = (typeof APP_MODULES)[number]['value']
