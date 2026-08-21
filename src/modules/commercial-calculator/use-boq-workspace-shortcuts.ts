import { useEffect } from 'react'

/** `Ctrl`/`Cmd`+`S` -> Save Draft, `Esc` -> collapse whichever single thing
 *  is currently open (BOQ workbench spec §11). Both pages call this once,
 *  at their root, with handlers reading/writing whatever state they already
 *  own — this hook holds no state itself. Omitting a handler makes that key
 *  a no-op rather than throwing. */
export function useBoqWorkspaceShortcuts({ onSave, onEscape }: {
  onSave?: () => void
  onEscape?: () => void
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isSaveCombo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'
      if (isSaveCombo) {
        e.preventDefault()
        onSave?.()
        return
      }
      if (e.key === 'Escape') {
        onEscape?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onSave, onEscape])
}
