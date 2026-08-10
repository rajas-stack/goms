import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'gorms:salesEditUnlocked'

interface SalesEditLockApi {
  unlocked: boolean
  toggle: () => void
}

const Ctx = createContext<SalesEditLockApi | null>(null)

/** Guards every action that can mutate SalesPerson data (Add, Edit, Change
 *  posting, Transfer book of business, Mark status, Remove) behind a
 *  session-persisted lock, defaulting to locked. Mounted once in
 *  `AppLayout.tsx` — global, not scoped to the Sales Team route, since
 *  `SalesPersonDetails` is also reachable from a Department's or Employee's
 *  "owner" link outside `/sales`. */
export function useSalesEditLock(): SalesEditLockApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSalesEditLock outside provider')
  return v
}

export function SalesEditLockProvider({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(STORAGE_KEY) === '1')

  // sessionStorage (not localStorage) is what gives "unlocked until this
  // browser tab's session ends" for free — it survives in-app navigation but
  // clears on a real reload or a new tab, with no separate timer needed.
  useEffect(() => {
    if (unlocked) sessionStorage.setItem(STORAGE_KEY, '1')
    else sessionStorage.removeItem(STORAGE_KEY)
  }, [unlocked])

  return <Ctx.Provider value={{ unlocked, toggle: () => setUnlocked((v) => !v) }}>{children}</Ctx.Provider>
}
