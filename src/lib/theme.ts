import { useCallback, useSyncExternalStore } from 'react'

/** What the user picked. `system` follows the OS and keeps following it. */
export type ThemePreference = 'light' | 'dark' | 'system'
/** What's actually painted. */
export type ResolvedTheme = 'light' | 'dark'

/** Also read by the pre-paint script in index.html — keep the two in sync. */
export const THEME_STORAGE_KEY = 'goms.theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'
const FADE_CLASS = 'theme-fade'
const FADE_MS = 320
const REVEAL_MS = 520
/** Browser-chrome color (mobile address bar, Capacitor status bar) per theme. */
const CHROME_COLOR: Record<ResolvedTheme, string> = { light: '#FAFAF7', dark: '#0A101C' }

const PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system']

function isPreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value)
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isPreference(stored) ? stored : 'system'
  } catch {
    // Storage blocked (private mode, sandboxed webview) — fall back to OS.
    return 'system'
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light'
  return preference
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function paint(theme: ResolvedTheme) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME_COLOR[theme])
}

/** Where a theme switch was triggered from — the circular reveal grows out
 *  of this point. Omit for a plain crossfade (e.g. keyboard shortcut). */
export interface RevealOrigin {
  x: number
  y: number
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> }
}

/** Paints `theme`, animated: a circular reveal from `origin` where the View
 *  Transitions API exists, otherwise a short color crossfade. Reduced-motion
 *  users get an instant swap. */
function transitionTo(theme: ResolvedTheme, origin?: RevealOrigin) {
  const root = document.documentElement
  if (root.classList.contains('dark') === (theme === 'dark')) {
    paint(theme)
    return
  }
  if (prefersReducedMotion()) {
    paint(theme)
    return
  }

  const doc = document as ViewTransitionDocument
  if (origin && typeof doc.startViewTransition === 'function') {
    const radius = Math.hypot(
      Math.max(origin.x, window.innerWidth - origin.x),
      Math.max(origin.y, window.innerHeight - origin.y),
    )
    const transition = doc.startViewTransition(() => paint(theme))
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${radius}px at ${origin.x}px ${origin.y}px)`] },
          { duration: REVEAL_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' },
        )
      })
      // The reveal is decoration — the theme has already been painted.
      .catch(() => {})
    return
  }

  root.classList.add(FADE_CLASS)
  paint(theme)
  window.setTimeout(() => root.classList.remove(FADE_CLASS), FADE_MS)
}

// ── Store ────────────────────────────────────────────────────────────────
// Module-level so every consumer (TopBar menu, Settings dialog, shortcut)
// shares one source of truth without a provider.

interface ThemeState {
  preference: ThemePreference
  resolved: ResolvedTheme
}

let state: ThemeState = { preference: 'system', resolved: 'light' }
const listeners = new Set<() => void>()
let initialized = false

function setState(next: ThemeState) {
  state = next
  listeners.forEach((l) => l())
}

function init() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  const preference = readStoredPreference()
  state = { preference, resolved: resolveTheme(preference, systemPrefersDark()) }
  paint(state.resolved)

  if (typeof window.matchMedia !== 'function') return
  window.matchMedia(DARK_QUERY).addEventListener('change', (e) => {
    if (state.preference !== 'system') return
    const resolved: ResolvedTheme = e.matches ? 'dark' : 'light'
    transitionTo(resolved)
    setState({ ...state, resolved })
  })
  // Another tab changed the theme — follow it.
  window.addEventListener('storage', (e) => {
    if (e.key !== THEME_STORAGE_KEY) return
    const preference = isPreference(e.newValue) ? e.newValue : 'system'
    const resolved = resolveTheme(preference, systemPrefersDark())
    transitionTo(resolved)
    setState({ preference, resolved })
  })
}

export function setThemePreference(preference: ThemePreference, origin?: RevealOrigin) {
  init()
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Not persisted, but still applied for this session.
  }
  const resolved = resolveTheme(preference, systemPrefersDark())
  transitionTo(resolved, origin)
  setState({ preference, resolved })
}

/** Flips day ↔ night as an explicit choice (leaves `system`). */
export function toggleTheme(origin?: RevealOrigin) {
  init()
  setThemePreference(state.resolved === 'dark' ? 'light' : 'dark', origin)
}

function subscribe(listener: () => void) {
  init()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ThemeState {
  init()
  return state
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const setPreference = useCallback((p: ThemePreference, origin?: RevealOrigin) => setThemePreference(p, origin), [])
  const toggle = useCallback((origin?: RevealOrigin) => toggleTheme(origin), [])
  return { ...snapshot, setPreference, toggle }
}

/** Center of an element — the reveal origin for a clicked control. */
export function originOf(el: Element | null): RevealOrigin | undefined {
  if (!el) return undefined
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}
