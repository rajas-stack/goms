export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = IS_MAC ? '⌘' : 'Ctrl'

/** Ctrl/⌘ + Shift + L — flips day ↔ night from anywhere. */
export function isThemeToggleShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l'
}

export const THEME_TOGGLE_KEYS: readonly string[] = [MOD, '⇧', 'L']

/** Shown in Settings → Keyboard shortcuts. Mirrors AppLayout's handlers. */
export const SHORTCUTS: readonly { label: string; keys: readonly string[] }[] = [
  { label: 'Search everything', keys: [MOD, 'K'] },
  { label: 'Search (alternative)', keys: ['/'] },
  { label: 'Toggle day / night', keys: THEME_TOGGLE_KEYS },
  { label: 'Close dialog or menu', keys: ['Esc'] },
]
