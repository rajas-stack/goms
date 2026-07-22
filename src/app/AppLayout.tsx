import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { Rail } from '@/components/Rail'
import { TopBar } from '@/components/TopBar'
import { MobileNavDrawer } from '@/components/MobileNavDrawer'
import { CommandPalette } from '@/components/CommandPalette'
import { ImportDialog } from '@/features/import/ImportDialog'
import { ToastProvider } from '@/components/ui/Toast'
import { isTypingTarget } from '@/lib/utils'
import { closeWorkspaceDialog, isWorkspaceDialogOpen } from '@/features/workspace/backButtonBridge'

interface ShellCtx {
  openSearch: () => void
  openImport: () => void
}
const Ctx = createContext<ShellCtx>({ openSearch: () => {}, openImport: () => {} })
export const useShell = () => useContext(Ctx)

export function AppLayout() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const navigate = useNavigate()

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

  // Latest overlay-open flags, readable from the back-button handler below
  // without having to re-subscribe the native listener on every toggle.
  const searchOpenRef = useRef(searchOpen)
  searchOpenRef.current = searchOpen
  const importOpenRef = useRef(importOpen)
  importOpenRef.current = importOpen
  const drawerOpenRef = useRef(drawerOpen)
  drawerOpenRef.current = drawerOpen

  // Android hardware back-button wiring. Only registers inside the native
  // Capacitor shell — `Capacitor.isNativePlatform()` is false in every
  // browser tab (including `npm run dev`/a deployed web build), so this
  // never touches browser back-button behavior on desktop/web.
  //
  // Priority mirrors Escape's dialog-first semantics (ui/Dialog.tsx): close
  // whatever overlay is open before ever navigating, and never do both on
  // the same press. Workspace dialogs (create/edit/move/delete node,
  // add/edit employee) live below this component in the tree, so they're
  // checked via the backButtonBridge module rather than useWorkspace().
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancelled = false
    let handle: PluginListenerHandle | undefined
    CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (isWorkspaceDialogOpen()) {
        closeWorkspaceDialog()
        return
      }
      if (searchOpenRef.current) {
        setSearchOpen(false)
        return
      }
      if (importOpenRef.current) {
        setImportOpen(false)
        return
      }
      if (drawerOpenRef.current) {
        setDrawerOpen(false)
        return
      }
      if (canGoBack) {
        navigate(-1)
        return
      }
      void CapacitorApp.exitApp()
    }).then((h) => {
      if (cancelled) {
        void h.remove()
        return
      }
      handle = h
    })
    return () => {
      cancelled = true
      handle?.remove()
    }
  }, [navigate])

  return (
    <ToastProvider>
      <Ctx.Provider value={{ openSearch: () => setSearchOpen(true), openImport: () => setImportOpen(true) }}>
        <div className="flex h-screen overflow-hidden bg-paper">
          <Rail />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar onOpenDrawer={() => setDrawerOpen(true)} />
            <main className="min-h-0 flex-1 overflow-hidden pb-16 lg:pb-0">
              <Outlet />
            </main>
          </div>
        </div>
        <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
        <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
        <MobileNavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </Ctx.Provider>
    </ToastProvider>
  )
}
