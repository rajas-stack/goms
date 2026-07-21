import { Dialog } from '@/components/ui/Dialog'

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: '← ↑ → ↓', action: 'Navigate hierarchy' },
  { keys: 'Enter', action: 'Open / expand selected' },
  { keys: '⌘/Ctrl + F', action: 'Search' },
  { keys: '⌘K or /', action: 'Search (alternate)' },
  { keys: '⌘/Ctrl + A', action: 'Expand all' },
  { keys: '⌘/Ctrl + ⇧ + A', action: 'Collapse all' },
  { keys: 'E', action: 'Expand all' },
  { keys: 'C', action: 'Collapse all' },
  { keys: 'F', action: 'Fit to screen' },
  { keys: '+ / =', action: 'Zoom in' },
  { keys: '−', action: 'Zoom out' },
  { keys: '0', action: 'Reset view' },
  { keys: 'Delete / Backspace', action: 'Delete selected' },
  { keys: 'Esc', action: 'Clear selection' },
  { keys: '?', action: 'Show this dialog' },
]

export function KeyboardShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className="space-y-1.5">
        {SHORTCUTS.map((s) => (
          <div key={`${s.action}-${s.keys}`} className="flex items-center justify-between gap-4 py-1">
            <span className="text-sm text-ink-800">{s.action}</span>
            <kbd className="rounded border border-line bg-panel px-2 py-1 font-mono text-[11px] text-muted">{s.keys}</kbd>
          </div>
        ))}
        <p className="pt-2 text-[12px] text-muted">
          The canvas is always in pan mode — drag any empty area to move around. Multi-select isn’t supported yet.
        </p>
      </div>
    </Dialog>
  )
}
