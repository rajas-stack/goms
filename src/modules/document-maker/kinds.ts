import type { MakerDocumentKind } from '@goms/domain'

/** Per-kind presentation, using the Office family colours mapped onto app tokens. */
export const KIND_META: Record<MakerDocumentKind, { icon: string; label: string; ext: string; tint: string; text: string; hint: string }> = {
  document: { icon: 'FileText', label: 'Document', ext: 'DOCX', tint: 'bg-blue/10', text: 'text-blue', hint: 'Letters, reports, proposals' },
  spreadsheet: { icon: 'FileSpreadsheet', label: 'Spreadsheet', ext: 'XLSX', tint: 'bg-emerald/10', text: 'text-emerald', hint: 'Budgets, trackers, BOQs' },
  presentation: { icon: 'Presentation', label: 'Presentation', ext: 'PPTX', tint: 'bg-amber/10', text: 'text-amber', hint: 'Pitches and review decks' },
}

export const MAKER_KIND_ORDER: MakerDocumentKind[] = ['document', 'spreadsheet', 'presentation']

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** "Just now", "5 min ago", "Yesterday", else a short date. */
export function editedLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const minutes = Math.round((now.getTime() - then.getTime()) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24 && then.getDate() === now.getDate()) return `${hours} h ago`
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (then.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}
