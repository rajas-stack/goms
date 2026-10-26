import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { retainedAssetsMiddleware } from './preview-retained-assets.mjs'

let directory, server, origin
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'goms-retained-assets-'))
  const current = join(directory, 'current'), releases = join(directory, 'releases'), fallback = join(directory, 'dist')
  for (const root of [current, join(releases, 'old'), fallback]) await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(current, 'assets', 'new-hash.js'), 'export const release = "new"')
  await writeFile(join(releases, 'old', 'assets', 'old-hash.js'), 'export const release = "old"')
  await writeFile(join(fallback, 'assets', 'legacy-hash.css'), 'body{color:blue}')
  const middleware = retainedAssetsMiddleware({ directory: current, releases, fallback })
  server = createServer((request, response) => { void middleware(request, response, () => request.url === '/assets/new-hash.js'
    ? response.writeHead(200, { 'Content-Type': 'text/javascript' }).end('export const release = "new"')
    : response.writeHead(200, { 'Content-Type': 'text/html' }).end('<div id="root"></div>')) })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${server.address().port}`
})
after(async () => { await new Promise(done => server.close(done)); await rm(directory, { recursive: true, force: true }) })
test('serves current and retained chunks as JavaScript', async () => {
  for (const name of ['new-hash.js', 'old-hash.js']) {
    const response = await fetch(`${origin}/assets/${name}`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/javascript')
    assert.match(await response.text(), /export const release/)
  }
})
test('retains the preceding dist assets and supports HEAD', async () => {
  const response = await fetch(`${origin}/assets/legacy-hash.css`, { method: 'HEAD' })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'text/css')
  assert.equal(await response.text(), '')
})
test('unknown assets return 404 rather than the SPA HTML', async () => {
  const response = await fetch(`${origin}/assets/missing.js`)
  assert.equal(response.status, 404)
  assert.doesNotMatch(await response.text(), /id="root"/)
})
test('blocks encoded traversal and preserves normal route fallback', async () => {
  assert.equal((await fetch(`${origin}/assets/%2e%2e%2fsecret.js`)).status, 400)
  const response = await fetch(`${origin}/live-bids/campaign`)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /id="root"/)
})
