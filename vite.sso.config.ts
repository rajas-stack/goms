// Local Google-SSO testing only (untracked helper; delete when no longer needed).
// Usage:  npx vite --config vite.sso.config.ts --mode sso --port 3000 --strictPort
// Forwards /api/** to the local API the same way Firebase Hosting's /api/** rewrite does in deployed environments, so the browser
// only ever sees one origin (localhost:3000) — the origin registered as the Google redirect URI. Does not touch vite.config.ts.
import { mergeConfig } from 'vite'
import base from './vite.config'

export default mergeConfig(base, {
  server: {
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: false } },
  },
})
