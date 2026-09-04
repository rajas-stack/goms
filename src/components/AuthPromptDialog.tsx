import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, type User } from 'firebase/auth'
import { auth, googleProvider } from '@/lib/firebaseAuth'
import { subscribeAuthRequired, type AuthPromptReason } from '@/lib/authPrompt'
import { Button } from '@/components/ui/Button'

export function AuthPromptDialog() {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<AuthPromptReason>('unauthorized')
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => onAuthStateChanged(auth, setUser), [])
  useEffect(() => subscribeAuthRequired((r) => { setReason(r); setOpen(true) }), [])

  if (!open) return null

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm space-y-4 rounded-xl bg-paper p-6 shadow-lg">
        {reason === 'forbidden' ? (
          <>
            <p className="text-sm font-medium text-ink">Your account isn't authorized</p>
            <p className="text-sm text-muted">
              {user?.email} is signed in, but GOMS requires a verified @amnex.com Google account for this action.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-ink">Sign in required</p>
            <p className="text-sm text-muted">
              Your session may have expired. Sign in with your Amnex Google account to continue.
            </p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => signInWithPopup(auth, googleProvider)}>Sign in with Google</Button>
        </div>
      </div>
    </div>
  )
}
