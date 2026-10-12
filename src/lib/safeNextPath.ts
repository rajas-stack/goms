/** The post-sign-in return path comes from the URL (`/login?next=...`), so it
 *  is attacker-controllable. Only a same-origin, app-relative path is honoured
 *  — anything else (absolute URLs, `//host`, `/\host`, control characters,
 *  `/login` itself) falls back to the home screen. */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001f]/.test(raw)) return '/'
  try {
    const url = new URL(raw, 'http://goms.invalid')
    if (url.origin !== 'http://goms.invalid') return '/'
    if (url.pathname === '/login' || url.pathname.startsWith('/login/')) return '/'
    return url.pathname + url.search + url.hash
  } catch {
    return '/'
  }
}
