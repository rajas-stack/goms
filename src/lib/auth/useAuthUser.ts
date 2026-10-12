import { useEffect, useState } from 'react'
import { authApi } from './authApi'
import type { AuthUser } from './types'

export function useAuthUser(): { user: AuthUser | null; loading: boolean } {
  const [state, setState] = useState<{ user: AuthUser | null; loading: boolean }>({ user: null, loading: authApi.configured })
  useEffect(() => authApi.subscribe((user, loading) => setState({ user, loading })), [])
  return state
}
