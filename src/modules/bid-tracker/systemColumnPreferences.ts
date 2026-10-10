import { auth } from '@/lib/firebaseAuth'

const key = (sheet: string, view: string) => `gorms:grid-columns:${auth?.currentUser?.uid ?? 'local'}:${sheet}:${view}`
export function readSystemColumns(sheet: string, view: string): string[] | undefined {
  try {
    const raw = localStorage.getItem(key(sheet, view))
    const columns: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(columns) && columns.length && columns.every(column => typeof column === 'string') ? columns : undefined
  } catch { return undefined }
}
export function saveSystemColumns(sheet: string, view: string, columns: string[] | undefined) {
  try { localStorage.setItem(key(sheet, view), JSON.stringify(columns ?? [])) } catch { /* The current view still updates if device storage is unavailable. */ }
}
