import { useSyncExternalStore } from 'react'
import type { GoogleService } from '@goms/domain'

export interface GoogleAccount { uid: string; email: string; googleId: string }
export interface GoogleSession { uid: string; email: string; accessToken: string; scopes: string[]; expiresAt: number; clientId: string }
let account: GoogleAccount | null = null
let sessions: GoogleSession[] = []
let revision = 0
const listeners = new Set<() => void>()
export function notifyIntegrations() { revision++; listeners.forEach(listener => listener()) }
export function setGoogleAccount(next: GoogleAccount | null) {
  if (account?.uid !== next?.uid || account?.email !== next?.email || account?.googleId !== next?.googleId) {
    sessions = []; account = next; notifyIntegrations()
  }
}
export const getGoogleAccount = () => account
export function assertGoogleAccount(expected: GoogleAccount) {
  if (!account || account.uid !== expected.uid || account.email !== expected.email || account.googleId !== expected.googleId) throw new Error('Your signed-in account changed. Please retry.')
}
export function saveGoogleSession(session: GoogleSession) {
  if (account?.uid !== session.uid || account.email !== session.email) throw new Error('Your signed-in account changed. Please retry.')
  sessions = sessions.filter(item => item.accessToken !== session.accessToken && item.expiresAt > Date.now()
    && !(item.clientId === session.clientId && item.scopes.every(scope => hasGoogleScope(session.scopes, scope))))
  sessions.push(session); notifyIntegrations()
}
export function hasGoogleScope(granted: readonly string[], required: string) {
  if (granted.includes(required)) return true
  if (required.startsWith('https://www.googleapis.com/auth/drive.') && granted.includes('https://www.googleapis.com/auth/drive')) return true
  return false
}
export function getGoogleSession(scopes: readonly string[], clientId?: string): GoogleSession | null {
  if (!account) return null
  return sessions.find(session => session.uid === account!.uid && session.email === account!.email && session.expiresAt > Date.now() + 30_000
    && (!clientId || session.clientId === clientId) && scopes.every(scope => hasGoogleScope(session.scopes, scope))) ?? null
}
export function disconnectGoogleIntegrations() { sessions = []; notifyIntegrations() }
export function invalidateGoogleSession(token: string) { sessions = sessions.filter(session => session.accessToken !== token); notifyIntegrations() }
export function useGoogleAccount() {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => revision, () => revision)
  return account
}
