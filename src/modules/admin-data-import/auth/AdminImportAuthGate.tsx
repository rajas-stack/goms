import { useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { auth, googleProvider } from '@/lib/firebaseAuth'
import { Button } from '@/components/ui/Button'

function useAdminImportUser() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false) }), [])
  return { user, loading }
}

export function AdminImportAuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAdminImportUser()

  if (loading) return null

  if (!user) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-paper p-8 text-center">
        <p className="max-w-sm text-sm text-muted">
          Sign in with your Amnex Google account to use Admin Data Import.
        </p>
        <Button variant="primary" onClick={() => signInWithPopup(auth, googleProvider)}>
          Sign in with Google
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-end gap-3 border-b border-line px-4 py-2 text-xs text-muted">
        <span>Signed in as {user.email}</span>
        <Button variant="ghost" size="sm" onClick={() => signOut(auth)}>Sign out</Button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
