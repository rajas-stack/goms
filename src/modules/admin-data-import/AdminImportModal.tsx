import { lazy, Suspense, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { RouteFallback } from '@/components/RouteFallback'
import { AdminImportAuthGate } from './auth/AdminImportAuthGate'
import { ImportNavProvider, type ImportNavTarget } from './ImportNavLink'

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
// each other via ImportNavLink (not raw `<Link>`) — an earlier version of
// this modal wrapped them in a MemoryRouter so their real `<Link>`s would
// "just work", but React Router throws ("You cannot render a <Router>
// inside another <Router>") the instant that subtree actually mounts,
// since the whole app already lives inside one Router (createBrowserRouter
// in router.tsx). Confirmed live 2026-09-04 — only reachable once
// authorized, so none of this session's earlier signed-out checks hit it.
// `step` + ImportNavProvider below is local state instead: no second
// Router, and the app's real browser history/URL is never touched.
//
// Closing the modal (Dialog.tsx only renders `children` while `open`)
// unmounts this whole subtree, so every reopen starts clean — matching the
// old ImportDialog's reset-on-close behavior. `handleClose` also resets
// `step` back to 'dashboard' since that state lives in this component,
// which itself stays mounted across opens/closes (only Dialog's internal
// children are gated on `open`).
//
// The full-page routes at /admin/data-import(/session|/geography) still
// exist in router.tsx for direct navigation/bookmarks/refresh — same
// components, same AdminImportAuthGate, and (with no ImportNavProvider in
// that tree) ImportNavLink falls back to a real `<Link>` there, so direct
// access enforces identical auth and keeps normal link semantics.
export function AdminImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<ImportNavTarget>('dashboard')

  function handleClose() {
    setStep('dashboard')
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Admin Data Import" size="full">
      <div className="lg:h-[75vh] lg:min-h-[420px] lg:overflow-y-auto">
        <AdminImportAuthGate>
          <ImportNavProvider value={setStep}>
            <Suspense fallback={<RouteFallback />}>
              {step === 'dashboard' && <AdminImportDashboard />}
              {step === 'session' && <SessionImportWizard />}
              {step === 'geography' && <GeographyLoadPanel />}
            </Suspense>
          </ImportNavProvider>
        </AdminImportAuthGate>
      </div>
    </Dialog>
  )
}
