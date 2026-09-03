import { useState } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '@/lib/firebaseAuth'
import { Dialog } from '@/components/ui/Dialog'
import { ImportDialog } from '@/features/import/ImportDialog'
import { AdminImportAuthGate, type AdminImportAuthPhase } from './auth/AdminImportAuthGate'

// Restores the pre-full-page-route Import UX: TopBar/GlobalFab's Import
// button opens this as an overlay on top of whatever page the user was on
// (AppLayout never navigates there — see openImport in AppLayout.tsx),
// instead of replacing the page. Auth still happens INSIDE the modal —
// AdminImportAuthGate's sign-in/unauthorized screens are reused unmodified,
// and the actual security boundary (verifyAdminImportToken's server-side
// allow-list check on every adminImport.* call) is untouched by this
// wrapper — a modal is presentation only, never a new trust boundary.
//
// By explicit request (2026-09-04): once authorized, this shows the
// existing ImportDialog experience (the pre-existing Departments/People
// importer), not the newer multi-domain session wizard — that wizard is
// still fully intact and reachable directly at /admin/data-import(/session|
// /geography) for anyone who navigates there, just no longer what this
// button opens by default. AdminImportAuthGate's `onPhaseChange` reports
// which screen it's showing (loading/signedOut/forbidden/authorized)
// without duplicating its auth logic here — once 'authorized', this swaps
// straight to <ImportDialog>, which owns its own Dialog chrome end to end
// (title, description, Cancel/Import footer), so there's never a second
// Dialog nested around it. That swap also drops AdminImportAuthGate's own
// "Signed in as X / Sign out" strip (it's part of the gate's authorized
// branch, which is bypassed once we render <ImportDialog> instead) —
// ImportDialog's optional signedInAs/onSignOut props (2026-09-04) put it
// back without needing a second Dialog. Sign-out closes the modal rather
// than trying to flip it back to the sign-in screen live, since nothing is
// watching auth state once AdminImportAuthGate has unmounted — reopening
// Import re-mounts it and picks up the signed-out state correctly.
export function AdminImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<AdminImportAuthPhase>('loading')
  const [email, setEmail] = useState<string | null>(null)

  function handleClose() {
    setPhase('loading')
    setEmail(null)
    onClose()
  }

  if (open && phase === 'authorized') {
    return (
      <ImportDialog
        open={open}
        onClose={handleClose}
        signedInAs={email ?? undefined}
        onSignOut={() => { void signOut(auth); handleClose() }}
      />
    )
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Admin Data Import" size="md">
      <AdminImportAuthGate onPhaseChange={(p, user) => { setPhase(p); setEmail(user?.email ?? null) }}>{null}</AdminImportAuthGate>
    </Dialog>
  )
}
