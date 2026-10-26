import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }

/** Old tabs still request their release's hashed chunks after a build. Keep those requests working,
 *  and never let an unknown JS URL fall through to Vite's HTML SPA fallback. */
export function retainedAssetsMiddleware({ directory, releases, fallback }) {
  return async (request, response, next) => {
    const pathname = (request.url ?? '').split('?')[0]
    if (!pathname.startsWith('/assets/')) return next()
    let path
    try { path = decodeURIComponent(pathname).slice(1) } catch { response.writeHead(400).end(); return }
    if (path.includes('..') || path.includes('\\') || path.includes('\0')) { response.writeHead(400).end(); return }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return }
    try {
      // Let Vite serve current assets with its normal compression/conditional caching.
      if ((await stat(resolve(directory, path)).catch(() => null))?.isFile()) return next()
      const retained = (await readdir(releases, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory()).map(entry => resolve(releases, entry.name)).reverse()
      for (const root of [...retained, fallback]) {
        if (!root) continue
        const file = resolve(root, path)
        if (!file.startsWith(resolve(root) + sep)) continue
        const info = await stat(file).catch(() => null)
        if (!info?.isFile()) continue
        response.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Content-Length': info.size,
          'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' })
        if (request.method === 'HEAD') response.end()
        else createReadStream(file).on('error', () => response.destroy()).pipe(response)
        return
      }
      response.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Asset not found')
    } catch (error) { next(error) }
  }
}

export function retainedPreviewAssets(workspace) {
  return {
    name: 'goms-retained-preview-assets',
    configurePreviewServer(server) {
      server.middlewares.use(retainedAssetsMiddleware({
        directory: resolve(server.config.root, server.config.build.outDir),
        releases: resolve(workspace, '..', '.goms-dev-server', 'releases'),
        fallback: resolve(workspace, 'dist'),
      }))
    },
  }
}
