// Side-effect module: it MUST be the FIRST import of src/main.tsx, so it runs before ./app/router creates the browser router (a router
// captures the initial location, `?auth_code=` included, at creation). It is a no-op for the Firebase default (the build-time constant below
// is false, so nothing is stripped, stashed or even bundled) and inside the Android shell, which receives its code as a deep link instead.
import { isGomsShell } from '@/lib/nativeShell'
import { stripAuthParamsEarly } from './bootstrap'

if (import.meta.env.VITE_AUTH_PROVIDER === 'oauth' && !isGomsShell()) stripAuthParamsEarly(window)
