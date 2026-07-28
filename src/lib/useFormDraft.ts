import { useCallback, useEffect, useRef, useState } from 'react'

/** Keeps a dialog's in-progress input alive across a reload, an Android back
 *  press, or the app being backgrounded and killed — the cases where a
 *  half-filled form would otherwise vanish with no way to get it back.
 *
 *  `sessionStorage`, not `localStorage`: a draft should outlive a reload and a
 *  closed dialog, but it should NOT still be sitting there next week waiting to
 *  ambush someone. Session storage is scoped to the tab (and to the app process
 *  in the Capacitor WebView), so drafts die naturally when the user is done.
 *  The `savedAt` age check below is a second guard for long-lived sessions.
 *
 *  Restoring is caller-driven rather than automatic: the dialog passes the
 *  value it WOULD have seeded (from the record, or empty for a create) into
 *  `take(seeded)`, and gets a draft back only if one exists and actually
 *  differs from that. That means no ordering dependency between this hook's
 *  effects and the dialog's own seeding effect, and no "we restored your
 *  changes" notice for a form nobody touched. */

const PREFIX = 'gorms:draft:'
const MAX_AGE_MS = 12 * 60 * 60 * 1000
const SAVE_DELAY_MS = 250

interface Stored<T> {
  savedAt: number
  form: T
}

export interface FormDraft<T> {
  /** Reads the stored draft for this key, returning it only if it differs from
   *  `seeded`. Call from the dialog's own seeding effect and use the result in
   *  place of `seeded` when it isn't null. */
  take: (seeded: T) => T | null
  /** Forgets the draft. Call after a successful save, so reopening the form
   *  starts from the saved record rather than the input that produced it. */
  clear: () => void
  /** True once `take` has handed back a draft — drives the "restored" notice. */
  restored: boolean
  /** Throws the draft away at the user's request. `onDiscard` (passed to the
   *  hook) is what re-seeds the form from the record. */
  discard: () => void
}

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored<T>
    if (!parsed || typeof parsed.savedAt !== 'number') return null
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      sessionStorage.removeItem(PREFIX + key)
      return null
    }
    return parsed.form
  } catch {
    // Unparseable leftovers, or storage blocked entirely (private mode, a
    // WebView with it disabled). Drafts are an enhancement — never fatal.
    return null
  }
}

/** @param key  Identifies this exact form instance — include the record id, so
 *              a draft for one person can never surface in another's form.
 *              `null` disables drafting (e.g. while the dialog has no target).
 * @param form  The live form state, saved as it changes while `open`.
 * @param onDiscard  Re-seeds the form from its record; invoked by `discard()`. */
export function useFormDraft<T>(key: string | null, form: T, open: boolean, onDiscard?: () => void): FormDraft<T> {
  const [restored, setRestored] = useState(false)

  // Latest values, so the flush-on-hide listener below stays registered once
  // instead of re-subscribing on every keystroke.
  const formRef = useRef(form)
  formRef.current = form
  const keyRef = useRef(key)
  keyRef.current = key
  const openRef = useRef(open)
  openRef.current = open
  const onDiscardRef = useRef(onDiscard)
  onDiscardRef.current = onDiscard

  /** Serialized form value that the record itself would produce, captured by
   *  `take`. Anything equal to it isn't a draft — it's just the form sitting at
   *  its starting point — so it must not be written. Without this, opening a
   *  dialog (or discarding a draft) would immediately store a "draft" identical
   *  to the record, which later edits to that record would then make LOOK like
   *  real unsaved input and restore over the top of them. */
  const baselineRef = useRef<string | null>(null)

  const write = useCallback(() => {
    const k = keyRef.current
    if (!k || !openRef.current) return
    if (baselineRef.current !== null && JSON.stringify(formRef.current) === baselineRef.current) return
    try {
      const stored: Stored<T> = { savedAt: Date.now(), form: formRef.current }
      sessionStorage.setItem(PREFIX + k, JSON.stringify(stored))
    } catch {
      // Quota or blocked storage — same reasoning as `read`.
    }
  }, [])

  // Debounced so typing doesn't serialize the whole form on every keystroke.
  useEffect(() => {
    if (!open || !key) return
    const t = setTimeout(write, SAVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [open, key, form, write])

  // Android can freeze the WebView the moment the app is backgrounded, which
  // would drop a debounced write still waiting in its timeout.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') write()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', write)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', write)
    }
  }, [write])

  // A closed dialog has no restored notice to show the next time it opens.
  useEffect(() => {
    if (!open) setRestored(false)
  }, [open])

  const take = useCallback((seeded: T): T | null => {
    const k = keyRef.current
    if (!k) return null
    const seededJson = JSON.stringify(seeded)
    baselineRef.current = seededJson
    const draft = read<T>(k)
    if (draft === null) return null
    // Identical to what the dialog was going to show anyway — nothing was
    // actually in progress, so restore silently (i.e. not at all).
    if (JSON.stringify(draft) === seededJson) {
      try {
        sessionStorage.removeItem(PREFIX + k)
      } catch { /* see `read` */ }
      return null
    }
    setRestored(true)
    return draft
  }, [])

  const clear = useCallback(() => {
    const k = keyRef.current
    if (!k) return
    try {
      sessionStorage.removeItem(PREFIX + k)
    } catch { /* see `read` */ }
    setRestored(false)
  }, [])

  const discard = useCallback(() => {
    clear()
    onDiscardRef.current?.()
  }, [clear])

  return { take, clear, restored, discard }
}
