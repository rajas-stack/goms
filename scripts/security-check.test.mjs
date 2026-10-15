import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const checker = fileURLToPath(new URL('./security-check.mjs', import.meta.url))

function fixture(t) {
  const prefix = join(resolve(tmpdir()), 'goms-security-check-')
  const dir = mkdtempSync(prefix)
  t.after(() => {
    assert.ok(resolve(dir).startsWith(prefix))
    rmSync(dir, { recursive: true, force: true })
  })
  execFileSync('git', ['init', '--quiet', dir], { windowsHide: true })
  writeFileSync(join(dir, 'firebase.json'), JSON.stringify({ hosting: { headers: [{ headers: [{
    key: 'Content-Security-Policy', value: "object-src 'none'; frame-ancestors 'none'; base-uri 'self'; script-src 'self'",
  }] }] } }))
  return dir
}

test('checks new saved source files without exposing a matching credential', t => {
  const dir = fixture(t)
  const marker = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')
  writeFileSync(join(dir, 'new-file.ts'), marker)
  const result = spawnSync(process.execPath, [checker], { cwd: dir, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /new-file.ts:1/)
  assert.ok(!result.stderr.includes(marker))
})

test('does not treat ignored local files as publishable source', t => {
  const dir = fixture(t)
  writeFileSync(join(dir, '.gitignore'), 'private-local.ts\n')
  writeFileSync(join(dir, 'private-local.ts'), ['-----BEGIN', 'PRIVATE KEY-----'].join(' '))
  const result = spawnSync(process.execPath, [checker], { cwd: dir, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
})
