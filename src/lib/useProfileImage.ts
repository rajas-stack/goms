import { useEffect, useRef, useState } from 'react'
import { authApi } from '@/lib/auth'
import { getAuthHeaders } from '@/data/remote/authHeaders'

export interface ProfileImageRef { userId: string; version: string }
/** Only visible avatars fetch bytes. The browser's private HTTP cache handles repeat requests and ETags. */
export function useProfileImage(image?: ProfileImageRef) {
  const ref = useRef<HTMLSpanElement & HTMLImageElement>(null)
  const [photo, setPhoto] = useState<{ key: string; url: string } | null>(null)
  const key = image ? `${image.userId}:${image.version}` : ''
  useEffect(() => {
    if (!image || !ref.current) return
    const controller = new AbortController(); let objectUrl = ''; let started = false; let cancelled = false
    const load = async () => {
      if (started) return; started = true
      try {
        const headers = await getAuthHeaders()
        if (!headers.Authorization || cancelled) return
        const response = await authApi.fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/profile-images/${encodeURIComponent(image.userId)}?v=${encodeURIComponent(image.version)}`, { headers, signal: controller.signal, cache: 'no-cache' })
        if (!response.ok || cancelled) return
        const blob = await response.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob); setPhoto({ key, url: objectUrl })
      } catch { /* Authorization, missing images and provider failures all retain the initials avatar. */ }
    }
    let first = true; let email: string | null = null
    const unsubscribe = authApi.subscribe(user => {
      if (first) { first = false; email = user?.email ?? null; return }
      if ((user?.email ?? null) === email) return
      cancelled = true; controller.abort(); setPhoto(null); if (objectUrl) URL.revokeObjectURL(objectUrl)
    })
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); void load() }
    }, { rootMargin: '100px' })
    if (observer) observer.observe(ref.current); else void load()
    return () => { cancelled = true; controller.abort(); observer?.disconnect(); unsubscribe(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [key])
  return { ref, url: photo?.key === key ? photo.url : null }
}
