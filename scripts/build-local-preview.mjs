import { spawn } from 'node:child_process'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stateDir = resolve(workspace, '..', '.goms-dev-server')
const release = resolve(stateDir, 'releases', new Date().toISOString().replace(/[:.]/g, '-'))
await mkdir(release, { recursive: true })
async function run(script, args) {
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve(workspace, script), ...args], { cwd: workspace, windowsHide: true, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? done() : reject(new Error(`Preview build failed (${code}). The previous preview stays online.`)))
  })
}
// Compile the domain and API, then check the complete frontend before publishing all saved source.
await run('node_modules/typescript/bin/tsc', ['-p', 'packages/domain/tsconfig.json'])
await run('node_modules/typescript/bin/tsc', ['-p', 'apps/api/tsconfig.json'])
await run('node_modules/typescript/bin/tsc', ['-b'])
await run('node_modules/vite/bin/vite.js', ['build', '--mode', 'local-preview', '--outDir', release, '--emptyOutDir'])
const pointer = resolve(stateDir, 'current-preview.json')
const temporary = `${pointer}.${process.pid}.tmp`
await writeFile(temporary, JSON.stringify({ directory: release, builtAt: new Date().toISOString() }, null, 2))
await rename(temporary, pointer)
console.log('Preview built successfully. Port 5173 will switch to this release automatically.')
