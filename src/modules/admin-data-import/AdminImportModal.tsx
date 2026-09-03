import { lazy, Suspense } from 'react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { Dialog } from '@/components/ui/Dialog'
import { RouteFallback } from '@/components/RouteFallback'
import { AdminImportAuthGate } from './auth/AdminImportAuthGate'

const AdminImportDashboard = lazy(() =>
  import('./AdminImportDashboard').then((m) => ({ default: m.AdminImportDashboard })),
)
const SessionImportWizard = lazy(() =>
  import('./SessionImportWizard').then((m) => ({ default: m.SessionImportWizard })),
)
const GeographyLoadPanel = lazy(() =>
  import('./GeographyLoadPanel').then((m) => ({ default: m.GeographyLoadPanel })),
)

// Restores the pre-full-page-route Import UX: TopBar/GlobalFab's Import
// button opens this as an overlay on top of whatever page the user was on
// (AppLayout never navigates there — see openImport in AppLayout.tsx),
// instead of replacing the page. Auth still happens INSIDE the modal —
// AdminImportAuthGate's sign-in/unauthorized/authorized branches are
// reused unmodified, and the actual security boundary (verifyAdminImportToken's
// server-side allow-list check on every adminImport.* call) is untouched by
// this wrapper — a modal is presentation only, never a new trust boundary.
//
// AdminImportDashboard/SessionImportWizard/GeographyLoadPanel cross-navigate
// each other with `<Link to="/admin/data-import...">` (unmodified). A
// MemoryRouter seeded at that same path lets those links work as-is inside
// the modal without touching the app's real browser history — closing the
// modal never leaves a stray /admin/data-import entry in history, and the
// whole subtree (including any in-progress upload/session state) unmounts
// with the closed dialog (Dialog.tsx only renders `children` while
// `open`), so every reopen starts clean, matching the old ImportDialog's
// reset-on-close behavior.
//
// The full-page routes at /admin/data-import(/session|/geography) still
// exist in router.tsx for direct navigation/bookmarks/refresh — same
// components, same AdminImportAuthGate, so direct access enforces identical
// auth. This modal is purely an additional entry point.
export function AdminImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Admin Data Import" size="full">
      <div className="lg:h-[75vh] lg:min-h-[420px] lg:overflow-y-auto">
        <AdminImportAuthGate>
          <MemoryRouter initialEntries={['/admin/data-import']}>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/admin/data-import" element={<AdminImportDashboard />} />
                <Route path="/admin/data-import/geography" element={<GeographyLoadPanel />} />
                <Route path="/admin/data-import/session" element={<SessionImportWizard />} />
              </Routes>
            </Suspense>
          </MemoryRouter>
        </AdminImportAuthGate>
      </div>
    </Dialog>
  )
}
