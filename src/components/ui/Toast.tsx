import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icon } from './Icon'
import { PERSIST_FAILED_EVENT, PERSIST_RECOVERED_EVENT, PERSIST_RETRY_EXHAUSTED_EVENT } from '@/data/persist'

interface ToastAction {
  label: string
  onClick: () => void
}

interface Toast {
  id: number
  message: string
  action?: ToastAction
}

const ToastCtx = createContext<(message: string, action?: ToastAction) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((message: string, action?: ToastAction) => {
    const id = ++nextId
    setToasts((t) => [...t, { id, message, action }])
    // A toast offering a manual retry stays up longer than the standard
    // 2600ms — the user needs enough time to notice and act on it, not just
    // read it before it disappears.
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 8000 : 2600)
  }, [])

  // Repeated failed writes (e.g. storage blocked for this browser/profile)
  // would otherwise retry silently forever — one warning per page load is
  // enough to tell the user their edits aren't being saved to this device.
  // The bounded automatic retry (persist.ts) may still recover on its own;
  // the two listeners below cover that outcome and the "gave up" outcome.
  const warnedThisLoad = useRef(false)
  useEffect(() => {
    function onPersistFailed() {
      if (warnedThisLoad.current) return
      warnedThisLoad.current = true
      push("Changes aren't saving to this device — check your browser's site storage settings.")
    }
    function onRetryExhausted(e: Event) {
      const { retry } = (e as CustomEvent<{ retry: () => void }>).detail
      push("Changes still aren't saving to this device.", { label: 'Retry', onClick: retry })
    }
    function onRecovered() {
      push('Changes are saving again.')
    }
    window.addEventListener(PERSIST_FAILED_EVENT, onPersistFailed)
    window.addEventListener(PERSIST_RETRY_EXHAUSTED_EVENT, onRetryExhausted)
    window.addEventListener(PERSIST_RECOVERED_EVENT, onRecovered)
    return () => {
      window.removeEventListener(PERSIST_FAILED_EVENT, onPersistFailed)
      window.removeEventListener(PERSIST_RETRY_EXHAUSTED_EVENT, onRetryExhausted)
      window.removeEventListener(PERSIST_RECOVERED_EVENT, onRecovered)
    }
  }, [push])

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
              {t.action && (
                <button
                  onClick={() => {
                    t.action!.onClick()
                    setToasts((ts) => ts.filter((x) => x.id !== t.id))
                  }}
                  className="ml-1 rounded-full bg-white/15 px-2 py-0.5 text-[12px] font-semibold text-paper hover:bg-white/25"
                >
                  {t.action.label}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}
