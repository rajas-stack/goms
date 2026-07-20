import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/** GitHub release assets aren't served with CORS headers, so the browser can't
 *  range-fetch the national village PMTiles archive directly. This proxies
 *  /geo-tiles/* to the release asset server-side (no CORS there), forwarding
 *  the Range header and adding permissive CORS on the way back — dev only; a
 *  production deploy would need an equivalent edge/serverless proxy. */
function pmtilesProxy(): Plugin {
  const target = 'https://github.com/yashveeeeeeer/india-geodata/releases/download/admin/villages/LGD_Villages.pmtiles'
  return {
    name: 'pmtiles-proxy',
    configureServer(server) {
      server.middlewares.use('/geo-tiles/LGD_Villages.pmtiles', async (req, res) => {
        try {
          const upstream = await fetch(target, {
            headers: req.headers.range ? { Range: req.headers.range as string } : {},
          })
          res.statusCode = upstream.status
          res.setHeader('Access-Control-Allow-Origin', '*')
          for (const h of ['content-length', 'content-range', 'accept-ranges', 'content-type']) {
            const v = upstream.headers.get(h)
            if (v) res.setHeader(h, v)
          }
          if (!upstream.body) { res.end(); return }
          for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk)
          res.end()
        } catch (e) {
          res.statusCode = 502
          res.end(String(e))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), pmtilesProxy()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
