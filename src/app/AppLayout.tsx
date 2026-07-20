import { createContext, useContext, useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Rail } from '@/components/Rail'
import { TopBar } from '@/components/TopBar'
import { CommandPalette } from '@/components/CommandPalette'
import { ImportDialog } from '@/features/import/ImportDialog'
import { ToastProvider } from '@/components/ui/Toast'
import { isTypingTarget } from '@/lib/utils'

interface ShellCtx {
  openSearch: () => void
  openImport: () => void
}
const Ctx = createContext<ShellCtx>({ openSearch: () => {}, openImport: () => {} })
export const useShell = () => useContext(Ctx)

export function AppLayout() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'f')) {
        // Ctrl/Cmd+K and Ctrl/Cmd+F both open search (F overrides browser find).
        e.preventDefault()
        setSearchOpen(true)
        return
      }
      // Fallback trigger — some browsers/host environments reserve Ctrl/Cmd+K
      // for their own address-bar search and never let the page see it.
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <ToastProvider>
      <Ctx.Provider value={{ openSearch: () => setSearchOpen(true), openImport: () => setImportOpen(true) }}>
        <div className="flex h-screen overflow-hidden bg-paper">
          <Rail />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main className="min-h-0 flex-1 overflow-hidden">
              <Outlet />
            </main>
          </div>
        </div>
        <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
        <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      </Ctx.Provider>
    </ToastProvider>
  )
}
