import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stateDir = resolve(workspace, '..', '.goms-dev-server')
await mkdir(stateDir, { recursive: true })
const lockPath = resolve(stateDir, 'watchdog.lock')
const statusPath = resolve(stateDir, 'status.json')
const logPath = resolve(stateDir, 'server.log')
const origin = 'http://127.0.0.1:5173'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

try {
  const lock = await open(lockPath, 'wx')
  await lock.writeFile(String(process.pid)); await lock.close()
} catch (error) {
  if (error.code !== 'EEXIST') throw error
  const pid = Number(await readFile(lockPath, 'utf8'))
  try { process.kill(pid, 0); process.exit(0) } catch { /* recover a stale lock after restart */ }
  await unlink(lockPath)
  const lock = await open(lockPath, 'wx')
  await lock.writeFile(String(process.pid)); await lock.close()
}

const log = createWriteStream(logPath, { flags: 'a' })
const report = message => log.write(`${new Date().toISOString()} ${message}\n`)
const status = state => writeFile(statusPath, JSON.stringify({ ...state, supervisorPid: process.pid, origin, logPath, checkedAt: new Date().toISOString() }, null, 2))
let stopping = false
let child
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child?.kill() })

async function healthy() {
  try {
    const response = await fetch(origin, { signal: AbortSignal.timeout(5000) })
    return response.ok && (await response.text()).includes('id="root"')
  } catch { return false }
}

async function previewDirectory() {
  try {
    const pointer = JSON.parse(await readFile(resolve(stateDir, 'current-preview.json'), 'utf8'))
    const directory = resolve(pointer.directory)
    if (!directory.startsWith(resolve(stateDir, 'releases') + '/') && !directory.startsWith(resolve(stateDir, 'releases') + '\\')) throw new Error('Invalid preview directory')
    await readFile(resolve(directory, 'index.html'))
    return directory
  } catch { return resolve(workspace, 'dist') }
}

try {
  while (!stopping) {
    // A manually started server is left alone. Resume ownership only after it stops.
    if (await healthy()) {
      await status({ state: 'healthy', managed: false })
      await pause(15000)
      continue
    }
    const directory = await previewDirectory()
    report(`Starting built preview on 127.0.0.1:5173 from ${directory}.`)
    child = spawn(process.execPath, [resolve(workspace, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', directory, '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
      cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GOMS_DEV_CACHE_DIR: resolve(stateDir, 'vite-supervised-cache') },
    })
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
    let exited = false
    child.once('error', error => { exited = true; report(`Vite failed: ${error.message}`) })
    child.once('exit', (code, signal) => { exited = true; report(`Vite exited (${code ?? signal}). Restarting in five seconds.`) })
    await status({ state: 'starting', managed: true, serverPid: child.pid })
    const startupDeadline = Date.now() + 30000
    while (!stopping && !exited && Date.now() < startupDeadline && !await healthy()) await pause(5000)
    let failures = 0
    while (!stopping && !exited) {
      const ok = await healthy()
      if (await previewDirectory() !== directory) { report('A successful preview build is ready; switching releases.'); child.kill(); break }
      failures = ok ? 0 : failures + 1
      await status({ state: ok ? 'healthy' : 'retrying', managed: true, serverPid: child.pid, failures })
      if (failures >= 6) { report('Six failed health checks; restarting Vite.'); child.kill(); break }
      await pause(15000)
    }
    if (stopping) child.kill()
    await pause(5000)
  }
} finally {
  child?.kill()
  await unlink(lockPath).catch(() => {})
  await status({ state: 'stopped' })
  log.end()
}
