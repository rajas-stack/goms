import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icon } from './Icon'

interface Toast {
  id: number
  message: string
}

const ToastCtx = createContext<(message: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((message: string) => {
    const id = ++nextId
    setToasts((t) => [...t, { id, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }, [])

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* `bottom-20` clears the mobile bottom-nav rail (`Rail.tsx`, ~56px tall
          plus its border, docked `<lg`, z-40) so toasts never appear crowded
          by/obscured behind it; `lg:bottom-5` restores the exact original
          desktop position, where the rail is a side rail instead. */}
      <div className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col gap-2 lg:bottom-5">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="pointer-events-auto flex items-center gap-2 rounded-full bg-ink-900 px-4 py-2 text-[13px] font-medium text-paper shadow-pop"
            >
              <Icon name="Check" size={14} className="text-indigo-100" />
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}
