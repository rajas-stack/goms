import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, renameSync, createWriteStream } from 'node:fs'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { acquireFileLock } from './local-sync-lock.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Reads a JSON file, or returns the fallback when it doesn't exist (no exists-then-read race). */
function readJsonIfPresent(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return fallback; throw error }
}
function readFileIfPresent(file) {
  try { return readFileSync(file) } catch (error) { if (error.code === 'ENOENT') return ''; throw error }
}
const stateDir = resolve(process.env.GOMS_SYNC_STATE_DIR || resolve(root, '..', '.goms-sync'))
const pauseFile = resolve(stateDir, 'paused')
const statusFile = resolve(stateDir, 'status.json')
const lockFile = resolve(stateDir, 'sync.lock')
const args = new Set(process.argv.slice(2))
const noreply = '248140904+shubhamrmehra-ship-it@users.noreply.github.com'
const branch = 'Shubham_Side'
mkdirSync(stateDir, { recursive: true })

if (args.has('--pause')) {
  writeFileSync(pauseFile, new Date().toISOString() + '\n')
  console.log('Local build, hosting, and remote publishing automation paused.')
  process.exit(0)
}
if (args.has('--resume')) {
  if (existsSync(pauseFile)) unlinkSync(pauseFile)
  console.log('Automation resumed. The next scheduled boundary will run normally.')
  process.exit(0)
}
if (args.has('--status')) {
  console.log(JSON.stringify({ paused: existsSync(pauseFile), lastRun: readJsonIfPresent(statusFile, null) }, null, 2))
  process.exit(0)
}
if (existsSync(pauseFile)) {
  console.log('Automation is paused; no build, deployment, or push performed.')
  process.exit(0)
}

const runId = new Date().toISOString().replace(/[^0-9]/g, '')
const runDir = resolve(stateDir, 'runs', runId)
mkdirSync(runDir, { recursive: true })
const logFile = resolve(runDir, 'run.log')
const previousStatus = readJsonIfPresent(statusFile, {})
const runStatus = { startedAt: new Date().toISOString(), runId, port: 8088, state: 'starting', previousPublished: previousStatus.previousPublished ?? null }
function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`
  appendFileSync(logFile, line)
  process.stdout.write(line)
}
function saveStatus(state, extra = {}) {
  Object.assign(runStatus, { state, updatedAt: new Date().toISOString() }, extra)
  const temporary = statusFile + '.tmp'
  writeFileSync(temporary, JSON.stringify(runStatus, null, 2) + '\n')
  renameSync(temporary, statusFile)
}
function git(parameters, options = {}) {
  return execFileSync('git', ['-C', root, ...parameters], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options }).trimEnd()
}
function command(program, parameters, options = {}) {
  log(`Running ${program} ${parameters.join(' ')}`)
  return new Promise((accept, reject) => {
    const child = spawn(program, parameters, { cwd: root, env: process.env, windowsHide: true, ...options })
    const output = chunk => { appendFileSync(logFile, chunk); process.stdout.write(chunk) }
    child.stdout.on('data', output)
    child.stderr.on('data', output)
    child.on('error', reject)
    child.on('close', code => code === 0 ? accept() : reject(new Error(`${program} failed with exit code ${code}`)))
  })
}
function assertRunning() {
  if (existsSync(pauseFile)) throw new Error('User paused automation; deployment and publishing stopped.')
}
function acquireLock() {
  return acquireFileLock(lockFile, { pid: process.pid, runId })
}
async function mapFiles(files, visitor) {
  let next = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < files.length) { const file = files[next++]; await visitor(file) }
  }))
}
async function capture(destination) {
  const head = git(['rev-parse', 'HEAD'])
  const files = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))].sort()
  const hashes = {}
  await mapFiles(files, async file => {
    const source = resolve(root, file)
    const rel = relative(root, source)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Source escaped the shared directory: ${file}`)
    try {
      // stat + read through one open handle, so the file checked is the file read (no check-then-use race).
      const handle = await open(source, 'r')
      let info, data
      try {
        info = await handle.stat()
        if (!info.isFile()) return
        data = await handle.readFile()
      } finally { await handle.close() }
      hashes[file] = createHash('sha256').update(data).digest('hex')
      if (destination) {
        const target = resolve(destination, file)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, data, { mode: info.mode })
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  })
  return { head, hashes, digest: createHash('sha256').update(JSON.stringify(Object.entries(hashes).sort())).digest('hex') }
}
async function snapshot(attempt) {
  const source = resolve(runDir, `source-${attempt}`)
  mkdirSync(source, { recursive: true })
  log(`Collecting saved source from the shared worktree into ${source}`)
  const captured = await capture(source)
  const latest = await capture()
  if (captured.digest !== latest.digest) throw new Error('Source changed during capture; retry after the agents finish their current edits.')
  captured.head = latest.head
  writeFileSync(resolve(runDir, `manifest-${attempt}.json`), JSON.stringify(captured, null, 2) + '\n')
  return { source, captured }
}
function composeConfiguration(source, images) {
  let files = ['compose.yaml']
  try {
    const info = JSON.parse(execFileSync('docker', ['inspect', 'goms-web-1'], { encoding: 'utf8' }))[0]
    const configured = info.Config.Labels['com.docker.compose.project.config_files']
    if (configured) files = configured.split(',').filter(file => basename(file) !== 'compose.override.json').map(file => {
      const sharedRelative = relative(root, file)
      if (!sharedRelative.startsWith('..') && !isAbsolute(sharedRelative)) return sharedRelative
      const stateRelative = relative(stateDir, file)
      if (stateRelative.startsWith('..') || isAbsolute(stateRelative)) throw new Error('Another deployment owns the Compose configuration.')
      return basename(file)
    })
  } catch { if (existsSync(resolve(root, 'compose.onlyoffice.yaml'))) files.push('compose.onlyoffice.yaml') }
  for (const file of files) {
    if (file.startsWith('..') || isAbsolute(file) || !existsSync(resolve(source, file))) throw new Error(`Unrecognized active Compose configuration: ${file}`)
  }
  const envSource = process.env.GOMS_SYNC_ENV_FILE || resolve(root, '.env')
  const envFile = resolve(runDir, 'runtime.env')
  writeFileSync(envFile, readFileIfPresent(envSource))
  const override = resolve(runDir, 'compose.override.json')
  writeFileSync(override, JSON.stringify({ services: {
    api: { image: images.api, build: { context: source } },
    migrate: { image: images.api, build: { context: source } },
    web: { image: images.web, build: { context: source } },
  } }, null, 2))
  return { args: ['compose', '--project-directory', root, '--env-file', envFile, ...files.flatMap(file => ['-f', resolve(source, file)]), '-f', override], env: { ...process.env, GOMS_PORT: '8088', GOMS_ORIGIN: 'http://localhost:8088' } }
}
async function verifyHost() {
  for (const endpoint of ['/healthz', '/']) {
    const result = await fetch(`http://localhost:8088${endpoint}`, { signal: AbortSignal.timeout(15000) })
    if (!result.ok) throw new Error(`Local host ${endpoint} returned ${result.status}`)
  }
  log('Local web health and SPA requests passed on port 8088.')
}
async function backupDatabase() {
  log('Backing up the current database before applying snapshot migrations.')
  const child = spawn('docker', ['exec', 'goms-db-1', 'pg_dump', '-U', 'goms', '-d', 'goms', '-Fc'], { windowsHide: true })
  const completion = new Promise((accept, reject) => {
    child.on('error', reject)
    child.on('close', code => code === 0 ? accept() : reject(new Error('Database backup failed; deployment was stopped.')))
  })
  child.stderr.on('data', chunk => appendFileSync(logFile, chunk))
  await Promise.all([pipeline(child.stdout, createWriteStream(resolve(runDir, 'postgres-before-deploy.dump'), { mode: 0o600 })), completion])
}
async function publish(candidate) {
  assertRunning()
  await command('git', ['-C', root, 'fetch', 'origin', branch])
  const remote = git(['rev-parse', `origin/${branch}`])
  let related = remote === candidate.captured.head
  try { git(['merge-base', '--is-ancestor', remote, candidate.captured.head]); related = true } catch { /* Check our prior snapshot below. */ }
  const previous = runStatus.previousPublished
  if (!related && previous?.commit === remote) {
    try { git(['merge-base', '--is-ancestor', previous.sourceHead, candidate.captured.head]); related = true } catch { /* A separate remote change must be reconciled first. */ }
  }
  if (!related) throw new Error('Remote branch advanced independently; preserving both histories. Reconcile its changes before the next automatic push.')
  const index = resolve(runDir, 'publish.index')
  const authorName = git(['config', 'user.name']) || 'Shubham Mehra'
  const env = { ...process.env, GIT_INDEX_FILE: index, GIT_AUTHOR_NAME: authorName, GIT_COMMITTER_NAME: authorName, GIT_AUTHOR_EMAIL: noreply, GIT_COMMITTER_EMAIL: noreply }
  git(['read-tree', remote], { env })
  git(['--work-tree', candidate.source, 'add', '-A', '--', '.'], { env })
  const tree = git(['write-tree'], { env })
  if (tree === git(['rev-parse', `${remote}^{tree}`])) { log('Remote already contains this snapshot.'); return }
  const commit = git(['commit-tree', tree, '-p', remote], { env, input: `chore: synchronize saved changes from all agents (${runId})\n` })
  const metadata = git(['show', '-s', '--format=%ae%n%ce', commit]).split('\n')
  if (metadata.some(email => email !== noreply)) throw new Error('Private commit metadata detected; refusing to push.')
  git(['update-ref', `refs/goms-sync/${runId}`, commit])
  assertRunning()
  await command('git', ['-C', root, 'push', 'origin', `${commit}:refs/heads/${branch}`])
  runStatus.previousPublished = { commit, sourceHead: candidate.captured.head, digest: candidate.captured.digest }
  saveStatus('published')
  log('Published the validated snapshot with GitHub noreply metadata; shared HEAD and index were preserved.')
}

if (!acquireLock()) { console.log('Another local sync is running; this invocation will not interfere.'); process.exit(0) }
try {
  if (git(['ls-files', '--unmerged'])) throw new Error('Resolve existing merge conflicts before building.')
  const worktrees = git(['worktree', 'list', '--porcelain']).split('\n').filter(line => line.startsWith('worktree '))
  if (worktrees.length !== 1) throw new Error('Additional worktrees exist; reconcile their saved updates into the shared worktree before hosting.')
  const slot = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
  const shouldPublish = args.has('--publish') || (args.has('--scheduled') && slot % 4 === 0)
  let candidate
  let configuration
  let images
  for (let attempt = 1; attempt <= 3; attempt++) {
    assertRunning()
    try { candidate = await snapshot(attempt) }
    catch (error) {
      if (!error.message.startsWith('Source changed during capture') || attempt === 3) throw error
      log('A save arrived during capture; taking a fresh shared snapshot.')
      continue
    }
    images = { api: `goms-api:sync-${runId}-${attempt}`, web: `goms-web:sync-${runId}-${attempt}` }
    configuration = composeConfiguration(candidate.source, images)
    saveStatus('building', { sourceHead: candidate.captured.head, sourceDigest: candidate.captured.digest, images })
    await command('docker', [...configuration.args, 'build', 'api', 'web'], { env: configuration.env })
    const latest = await capture()
    if (latest.head === candidate.captured.head && latest.digest === candidate.captured.digest) break
    candidate = null
    log('More saved updates arrived during the build; capturing all agents again before hosting.')
  }
  if (!candidate) throw new Error('Agents are still changing source after three builds; the last healthy deployment was preserved. Run sync again when their edits settle.')
  assertRunning()
  await backupDatabase()
  assertRunning()
  saveStatus('deploying')
  await command('docker', [...configuration.args, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180', 'web'], { env: configuration.env })
  await verifyHost()
  const release = { ...runStatus, composeArgs: configuration.args, images, source: candidate.source }
  writeFileSync(resolve(stateDir, 'current-release.json'), JSON.stringify(release, null, 2) + '\n')
  saveStatus('hosted')
  if (shouldPublish) await publish(candidate)
  saveStatus('complete', { completedAt: new Date().toISOString() })
  log('Complete build and local hosting finished. No user browser was opened or reloaded.')
} catch (error) {
  saveStatus('failed', { error: error.message })
  log(`FAILED: ${error.message}`)
  process.exitCode = 1
} finally {
  try { if (JSON.parse(readFileSync(lockFile, 'utf8')).pid === process.pid) unlinkSync(lockFile) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
