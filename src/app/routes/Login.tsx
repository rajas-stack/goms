import { Navigate, useSearchParams } from 'react-router-dom'
import amnexLogo from '@/assets/amnex-logo.svg'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { isAmnexAccount, useGoogleSignIn } from '@/lib/useGoogleSignIn'
import { safeNextPath } from '@/lib/safeNextPath'

function GoogleMark() {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="16" height="16">
        <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81Z" />
        <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3a7.2 7.2 0 0 1-10.7-3.78H1.35v3.1A12 12 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.37 14.31a7.2 7.2 0 0 1 0-4.62v-3.1H1.35a12 12 0 0 0 0 10.82l4.02-3.1Z" />
        <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.35 6.59l4.02 3.1A7.2 7.2 0 0 1 12 4.77Z" />
      </svg>
    </span>
  )
}

export function Login() {
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const { configured, user, resolved, status, signIn, switchAccount } = useGoogleSignIn()

  if (user && isAmnexAccount(user)) return <Navigate to={next} replace />

  const rejected = Boolean(user)
  const signingIn = status === 'signing-in'
  const busy = signingIn || !resolved

  return (
    <main className="survey-grid flex min-h-full items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-[400px] animate-fade-in rounded-card border border-line bg-white p-6 shadow-panel sm:p-8">
        <img src={amnexLogo} alt="Amnex" className="h-9 w-auto" />
        <p className="eyebrow mt-8">GOMS</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink-900">Sign in</h1>
        <p className="mt-2 text-sm text-muted">Use your Amnex Google account (@amnex.com).</p>

        {rejected && (
          <div role="alert" className="mt-6 rounded-lg bg-crimson-100 p-3 text-sm text-crimson">
            <p className="font-medium">Your account isn't authorized</p>
            <p className="mt-1">
              {user?.email} is signed in, but GOMS requires a verified @amnex.com Google account.
            </p>
          </div>
        )}

        {rejected ? (
          <Button variant="primary" className="mt-6 h-11 w-full" onClick={() => void switchAccount()}>
            Use a different account
          </Button>
        ) : (
          <Button variant="primary" className="mt-6 h-11 w-full" disabled={!configured || busy} onClick={signIn}>
            {busy ? <Icon name="Loader" className="animate-spin" size={16} /> : <GoogleMark />}
            {signingIn ? 'Signing in…' : 'Continue with Google'}
          </Button>
        )}

        {!configured && (
          <p className="mt-3 text-xs text-muted">Sign-in is not configured for this deployment.</p>
        )}
        {status === 'error' && !rejected && (
          <p role="alert" className="mt-3 text-xs text-crimson">Sign-in failed. Try again.</p>
        )}

        <p className="mt-8 border-t border-line pt-4 text-xs text-muted">
          Trouble signing in? Contact your GOMS administrator.
        </p>
      </div>
    </main>
  )
}
