import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

const STORAGE_KEY = 'goms.eye-comfort'
type Comfort = { enabled: boolean; strength: number }
const DEFAULT: Comfort = { enabled: false, strength: 40 }
function read(): Comfort {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return { enabled: value?.enabled === true, strength: typeof value?.strength === 'number' && Number.isFinite(value.strength) ? Math.max(0, Math.min(100, value.strength)) : 40 }
  } catch { return DEFAULT }
}
let state = read()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())
if (typeof window !== 'undefined') window.addEventListener('storage', event => { if (event.key === STORAGE_KEY || event.key === null) { state = read(); emit() } })
export function setEyeComfort(update: Partial<Comfort>) {
  state = { ...state, ...update, strength: Math.max(0, Math.min(100, update.strength ?? state.strength)) }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* Session still works without storage. */ }
  emit()
}
export function useEyeComfort() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => state, () => DEFAULT)
}
export function EyeComfortOverlay() {
  const { enabled, strength } = useEyeComfort()
  return createPortal(<div data-eye-comfort aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 2147483647,
    pointerEvents: 'none', backgroundColor: '#ffae45', mixBlendMode: 'multiply', opacity: enabled ? strength / 100 * .24 : 0 }} />, document.body)
}
