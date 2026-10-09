import type { GoogleService } from '@goms/domain'
const scope = (name: string) => `https://www.googleapis.com/auth/${name}`
export const GOOGLE_PRODUCTS: readonly { id: GoogleService; name: string; icon: string; url: string; scopes: string[]; mode: 'api' | 'web' | 'cloud' }[] = [
  { id: 'gmail', name: 'Gmail', icon: 'Mail', url: 'https://mail.google.com/mail/', scopes: [scope('gmail.metadata')], mode: 'api' },
  { id: 'drive', name: 'Drive', icon: 'Folder', url: 'https://drive.google.com/drive/', scopes: [scope('drive')], mode: 'api' },
  { id: 'docs', name: 'Docs', icon: 'FileText', url: 'https://docs.google.com/document/', scopes: [scope('documents.readonly'), scope('drive.metadata.readonly')], mode: 'api' },
  { id: 'sheets', name: 'Sheets', icon: 'FileSpreadsheet', url: 'https://docs.google.com/spreadsheets/', scopes: [scope('spreadsheets.readonly'), scope('drive.metadata.readonly')], mode: 'api' },
  { id: 'calendar', name: 'Calendar', icon: 'CalendarDays', url: 'https://calendar.google.com/calendar/', scopes: [scope('calendar.calendarlist.readonly'), scope('calendar.events.readonly')], mode: 'api' },
  { id: 'chat', name: 'Chat', icon: 'MessageSquareText', url: 'https://chat.google.com/', scopes: [scope('chat.spaces.readonly')], mode: 'api' },
  { id: 'meet', name: 'Meet', icon: 'Video', url: 'https://meet.google.com/', scopes: [scope('meetings.space.readonly')], mode: 'api' },
  { id: 'maps', name: 'Maps', icon: 'MapPin', url: 'https://maps.google.com/', scopes: [], mode: 'web' },
  { id: 'translate', name: 'Translate', icon: 'Languages', url: 'https://translate.google.com/', scopes: [scope('cloud-translation')], mode: 'cloud' },
  { id: 'sites', name: 'Sites', icon: 'PanelsTopLeft', url: 'https://sites.google.com/', scopes: [scope('drive.metadata.readonly')], mode: 'api' },
  { id: 'keep', name: 'Notes (Keep)', icon: 'StickyNote', url: 'https://keep.google.com/', scopes: [scope('keep.readonly')], mode: 'api' },
  { id: 'notebooklm', name: 'NotebookLM', icon: 'BookOpen', url: 'https://notebooklm.google.com/', scopes: [scope('cloud-platform')], mode: 'cloud' },
  { id: 'tasks', name: 'Tasks', icon: 'ClipboardCheck', url: 'https://tasks.google.com/', scopes: [scope('tasks.readonly')], mode: 'api' },
]
export const productFor = (id: GoogleService) => GOOGLE_PRODUCTS.find(product => product.id === id)!
export function googleProductUrl(id: GoogleService, email: string | undefined): string {
  const url = new URL(productFor(id).url)
  if (email) url.searchParams.set('authuser', email)
  return url.toString()
}
