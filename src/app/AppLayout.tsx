import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { AccountMappingRail } from '@/components/AccountMappingRail'
import { SecondaryNav } from '@/components/SecondaryNav'
import { TopBar } from '@/components/TopBar'
import { MobileNavDrawer } from '@/components/MobileNavDrawer'
import { CommandPalette } from '@/components/CommandPalette'
import { GlobalFab } from '@/components/GlobalFab'
import { RouteFallback } from '@/components/RouteFallback'
import { ImportDialog } from '@/features/import/ImportDialog'
import { ExportDialog } from '@/features/import/ExportDialog'
import { ToastProvider } from '@/components/ui/Toast'
import { SalesEditLockProvider } from '@/features/sales/salesEditLock'
import { cn, isTypingTarget } from '@/lib/utils'
import { useMediaQuery } from '@/lib/useMediaQuery'
import {
  clearWorkspaceSelection, closeFabOverlay, closeWorkspaceDialog, isFabOverlayOpen, isWorkspaceDialogOpen,
  isWorkspaceSelectionActive,
} from '@/features/workspace/backButtonBridge'

// Lazy, like router.tsx's admin-import routes — keeps AdminImportAuthGate's
// firebase/auth import (and everything the modal's content pulls in) out of
// the main chunk for every build, including goms-prod where the flag below
// is off and this is never rendered at all.
const AdminImportModal = lazy(() =>
  import('@/modules/admin-data-import/AdminImportModal').then((m) => ({ default: m.AdminImportModal })),
)

interface ShellCtx {
  openSearch: () => void
  openImport: () => void
  openExport: () => void
  /** Whether SecondaryNav (Map/Directory/Insights/Meetings) is showing —
   *  derived straight from the route (anywhere but Home), so it can never
   *  drift out of sync with a reload, deep link, or browser back/forward. */
  navExpanded: boolean
}
const Ctx = createContext<ShellCtx>({
  openSearch: () => {}, openImport: () => {}, openExport: () => {}, navExpanded: false,
})
export const useShell = () => useContext(Ctx)

export function AppLayout() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const navExpanded =
    location.pathname !== '/'
    && !location.pathname.startsWith('/commercial-calculator')
    && !location.pathname.startsWith('/bid-tracker')
  // `MobileDetailsSheet` only renders as an overlay below `lg` (it's
  // `lg:hidden`) — at `lg` and up the same selection drives the always-visible
  // desktop `<aside>`, which isn't an overlay to close on back, so the
  // back-button handler below needs the live breakpoint alongside the
  // selection state itself.
  const isMobile = useMediaQuery('(max-width: 1023.98px)')

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
  const exportOpenRef = useRef(exportOpen)
  exportOpenRef.current = exportOpen
  const drawerOpenRef = useRef(drawerOpen)
  drawerOpenRef.current = drawerOpen
  const isMobileRef = useRef(isMobile)
  isMobileRef.current = isMobile

  // Android hardware back-button wiring. Only registers inside the native
  // Capacitor shell — `Capacitor.isNativePlatform()` is false in every
  // browser tab (including `npm run dev`/a deployed web build), so this
  // never touches browser back-button behavior on desktop/web.
  //
  // Priority mirrors Escape's dialog-first semantics (ui/Dialog.tsx): close
  // whatever overlay is open before ever navigating, and never do both on
  // the same press. Workspace dialogs (create/edit/move/delete node,
  // add/edit employee) live below this component in the tree, so they're
  // checked via the backButtonBridge module rather than useWorkspace(). The
  // `MobileDetailsSheet` check below is the same story: it's driven by
  // `ws.selection`, owned by whichever `WorkspaceProvider` is mounted, not by
  // this component — hence the same bridge, gated on the live viewport width
  // since the sheet is an overlay only below `lg` (at `lg`+ the same
  // selection just drives the always-visible desktop details `<aside>`).
  //
  // The global FAB (menu + its own state/org/geo/timeline pickers) is
  // checked FIRST: it's the newest/topmost overlay a back press could be
  // dismissing, and — unlike the checks below it — nothing else in this
  // chain can be open AT THE SAME TIME as one of the FAB's own picker steps
  // (picking a target always closes the FAB's flow before it hands off to
  // an actual workspace dialog), so there's no ordering conflict either way,
  // but checking it first matches how it visually layers on top.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancelled = false
    let handle: PluginListenerHandle | undefined
    CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (isFabOverlayOpen()) {
        closeFabOverlay()
        return
      }
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
      if (exportOpenRef.current) {
        setExportOpen(false)
        return
      }
      if (drawerOpenRef.current) {
        setDrawerOpen(false)
        return
      }
      if (isMobileRef.current && isWorkspaceSelectionActive()) {
        clearWorkspaceSelection()
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
    <SalesEditLockProvider>
      <ToastProvider>
        <Ctx.Provider value={{
          openSearch: () => setSearchOpen(true),
          // Root-caused 2026-09-03: ImportDialog (below) is a separate, older,
          // always-unauthenticated CSV importer (departments/people only) —
          // TopBar/GlobalFab's "Import" button opened it directly, giving a
          // signed-out user a second, un-gated door into data Admin Data
          // Import was built specifically to put behind Google Sign-In +
          // server-side allow-list. When that feature is enabled
          // (VITE_ADMIN_IMPORT_ENABLED), this button opens AdminImportModal
          // instead (below) — same auth-gated content as the /admin/data-import
          // route, just as a modal over the current page rather than a
          // full-page navigation, restoring the pre-existing Import UX.
          // Falls back to the old dialog only when the flag is off (e.g.
          // goms-prod today), so that build's existing working import path
          // is untouched. Neither branch calls `navigate()` — the current
          // page/route is never replaced.
          openImport: () => setImportOpen(true),
          openExport: () => setExportOpen(true), navExpanded,
        }}>
          <div className="flex h-screen overflow-hidden bg-paper">
            <AccountMappingRail />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar onOpenDrawer={() => setDrawerOpen(true)} />
              {navExpanded && <SecondaryNav />}
              {/* `pb-14` matches SecondaryNav's fixed mobile bar height. */}
              <main className={cn('min-h-0 flex-1 overflow-hidden', navExpanded && 'pb-14 lg:pb-0')}>
                <Suspense fallback={<RouteFallback />}>
                  <Outlet />
                </Suspense>
              </main>
            </div>
          </div>
          <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
          {import.meta.env.VITE_ADMIN_IMPORT_ENABLED === 'true'
            ? (
              <Suspense fallback={null}>
                <AdminImportModal open={importOpen} onClose={() => setImportOpen(false)} />
              </Suspense>
            )
            : <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />}
          <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
          <MobileNavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
          {navExpanded && <GlobalFab />}
        </Ctx.Provider>
      </ToastProvider>
    </SalesEditLockProvider>
  )
}
